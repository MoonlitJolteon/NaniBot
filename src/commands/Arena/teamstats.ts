import { CommandInteraction, MessageAttachment, MessageEmbed } from "discord.js";
import nodeHtmlToImage from "node-html-to-image";
import * as fs from 'fs/promises';
import dayjs from 'dayjs';
import fuzzysort from "fuzzysort";

import { bot } from '../../index';
import * as ignite from '../../helpers/igniteAPI';
import * as vrml from '../../helpers/vrmlAPI';
import * as divColor from '../../helpers/divisionBasedColors';

let errorNoUser = new MessageEmbed().setColor("#FF0000").setTitle("Error").setDescription(`Please set your oculus name first using \`/oculusname\`, or search for another user by specifying a user.`);
let errorNoTeam = new MessageEmbed().setColor("#FF0000").setTitle("Error").setDescription("I was unable to find the team, please make sure you spelled the team name correctly. Do note that if the team is retired, or has never gone active, I won't be able to find your team.");

module.exports = {
  //Command metadata
  type: "slash",
  name: "teamstats",
  description: "Get a team's stats",
  options: [
    {
      name: "teamname",
      description: "VRML team to search for",
      type: "STRING",
      required: false
    }
  ],

  async execute({ interaction }: { interaction: CommandInteraction }) {
    await interaction.deferReply();
    let teamToFind = interaction.options.getString('teamname');
    let teamID;
    if (teamToFind == undefined) {
      let userToFind = await bot.oculusNames.get(interaction!.member!.user.id);
      if (userToFind == undefined) return interaction.editReply({ embeds: [errorNoUser] });
      let igniteData = await ignite.getPlayerCache(userToFind);
      interaction.editReply("Searching for your team...");
      teamToFind = igniteData?.vrml_player?.team_name;
      teamID = igniteData?.vrml_player?.team_id

    } else {
      interaction.editReply(`Searching for ${teamToFind}...`);
    }

    if (teamToFind == undefined) return interaction.editReply({ embeds: [errorNoTeam] });
    if (teamID == undefined) {
      let teams;
      teams = await vrml.searchTeamNameCache(teamToFind);
      if (teams.length <= 0) return interaction.editReply({ embeds: [errorNoTeam] });


      let teamsSorted = fuzzysort.go(teamToFind, teams, { key: "name" });
      teamID = teams.filter((team: { name: string; }) => team.name == teamsSorted[0].target)[0].id;
    }
    const teamInfo = await vrml.getTeamInfoCache(teamID);
    if (teamInfo == undefined) return interaction.editReply({ embeds: [errorNoTeam] });
    const teamLogoURL = `https://www.vrmasterleague.com/${teamInfo.teamLogo}`
    const divisionURL = `https://www.vrmasterleague.com/${teamInfo.divisionLogo}`
    const division = teamInfo.divisionName;
    const teamWL = `${teamInfo.w}-${teamInfo.l}`
    const rank = teamInfo.rank;
    let region = teamInfo.regionName;
    const teamName = teamInfo.teamName;

    switch (region) {
      case 'America East':
        region = "NA/E";
        break;
      case 'America West':
        region = "NA/W";
        break;
      case 'Europe':
        region = "EU";
        break;
      case 'Oceania/Asia':
        region = "OA";
        break;
    }

    await interaction.editReply(`Searching for ${teamName}'s matches...`);
    let historicMatches = await vrml.getTeamMatchesCache(true, teamID);
    const currSeason = await vrml.getCurrentSeasonCache();
    historicMatches = historicMatches.filter((match: any) => match.seasonName == currSeason.seasonName);

    const lastSixMatches = historicMatches.splice(0, 6);

    let html = '<p>Something broke.. contact MunelitJolty#0447 if you see this message and tell her what you did to get it</p>';
    await fs.readFile(__dirname.replace("\\", "/") + '/../../res/layouts/teamstats.handlebars').then((data) => {
      html = data.toString();
    })


    let backgroundColors = divColor.divisionBasedColor(division);
    let panel = backgroundColors.panel;
    let background = backgroundColors.background;
    let switchDivision = backgroundColors.switchDivision;

    let score;
    if (switchDivision == "Master" && region != "OA") {
      score = {
        mmr: false,
        score: teamInfo.pts
      }
    } else {
      score = {
        mmr: true,
        score: teamInfo.mmr
      }
    }

    let matches = [];
    for (let match of lastSixMatches) {
      let teams = {
        [match.homeTeam.teamID]: { name: match.homeTeam.teamName.split('<i>')[0], score: match.homeScore },
        [match.awayTeam.teamID]: { name: match.awayTeam.teamName.split('<i>')[0], score: match.awayScore }
      }
      let winningTeam = teams[match.winningTeamID];
      let losingTeam = teams[match.losingTeamID];
      let searchedTeamWon = teamInfo.teamID == match.winningTeamID;
      const timezone = bot.guildSettings.get(`${interaction!.guildId!}-timezone`);
      let date = dayjs(`${match.dateScheduledUTC}`, "YYYY-MM-DD HH:mm").tz(timezone || "America/New_York").format("MMM D");
      let forfeit = match.isForfeit;
      let newMatch = {
        winningTeam,
        losingTeam,
        searchedTeamWon,
        match,
        date,
        forfeit
      }
      matches.push(newMatch);
    }

    let image = await nodeHtmlToImage({
      html: html,
      content: {
        logoSource: teamLogoURL,
        teamName: teamName,
        score,
        teamWL: teamWL,
        divisionURL,
        division,
        panel,
        background,
        matches,
        rank,
        region
      }
    }) as Buffer;

    let attach = new MessageAttachment(image, 'teamstats.png');
    let embed = new MessageEmbed()
      .setTitle(`${teamInfo.teamName}'s stats:`)
      .setDescription(`This only shows the most recent 6 games.\n${teamInfo.bio.discordInvite ? `Team Discord: ${teamInfo.bio.discordInvite}` : ""}\nTeam Page: [Click Here](https://vrmasterleague.com/EchoArena/Teams/${teamInfo.teamID})`)
      .setImage(`attachment://teamstats.png`);
    interaction.editReply({ embeds: [embed], files: [attach] });


  }
}