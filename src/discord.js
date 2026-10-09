const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("./db");
const { panelPayload, handleShiftButton } = require("./fichajes");
const { generateAudio, getUsedToday, GenerationError, DEFAULT_DAILY_LIMIT } = require("./generator");

const MAX_TEXT = 1000;

const commands = [
  new SlashCommandBuilder()
    .setName("voz")
    .setDescription("Genera una nota de voz con la voz de una modelo")
    .addStringOption((o) =>
      o.setName("modelo").setDescription("Modelo").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("texto").setDescription("Texto a decir").setRequired(true).setMaxLength(MAX_TEXT)
    ),
  new SlashCommandBuilder()
    .setName("frase")
    .setDescription("Genera una nota de voz a partir de una frase pre-armada")
    .addStringOption((o) =>
      o.setName("modelo").setDescription("Modelo").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("frase").setDescription("Frase").setRequired(true).setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("panel-fichajes")
    .setDescription("(Manager) Publica el panel de fichajes en este canal")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  new SlashCommandBuilder().setName("uso").setDescription("Tu consumo de caracteres de hoy"),
  new SlashCommandBuilder()
    .setName("vincular")
    .setDescription("(Manager) Vincula un usuario de Discord con un chatter")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("usuario").setDescription("Usuario de Discord").setRequired(true))
    .addStringOption((o) =>
      o.setName("chatter").setDescription("Chatter").setRequired(true).setAutocomplete(true)
    ),
].map((c) => c.toJSON());

function chatterFor(discordId) {
  return db.prepare("SELECT * FROM chatters WHERE discord_id = ? AND active = 1").get(discordId);
}

function autocompleteRows(kind, query) {
  const q = `%${query}%`;
  if (kind === "modelo") {
    return db
      .prepare("SELECT id, name FROM models WHERE active = 1 AND name LIKE ? ORDER BY name LIMIT 25")
      .all(q)
      .map((r) => ({ name: r.name, value: String(r.id) }));
  }
  if (kind === "frase") {
    return db
      .prepare("SELECT id, label FROM phrases WHERE label LIKE ? ORDER BY label LIMIT 25")
      .all(q)
      .map((r) => ({ name: r.label.slice(0, 100), value: String(r.id) }));
  }
  if (kind === "chatter") {
    return db
      .prepare("SELECT id, name FROM chatters WHERE active = 1 AND name LIKE ? ORDER BY name LIMIT 25")
      .all(q)
      .map((r) => ({ name: r.name, value: String(r.id) }));
  }
  return [];
}

async function replyWithAudio(interaction, chatter, modelId, text) {
  // Efímero: solo lo ve quien lo pidió, así no se filtran audios en el canal.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { buffer, source } = await generateAudio({ chatterId: chatter.id, modelId, text });
    const model = db.prepare("SELECT name FROM models WHERE id = ?").get(modelId);
    const file = new AttachmentBuilder(buffer, { name: `${model.name.replace(/\W+/g, "_")}.mp3` });
    await interaction.editReply({
      content: `Listo (${source === "cache" ? "desde caché, sin costo" : "generado"}).`,
      files: [file],
    });
  } catch (err) {
    const known = err instanceof GenerationError;
    if (!known) console.error(err);
    await interaction.editReply({
      content: `❌ ${known ? err.message : "Error inesperado, avisá a un manager."}`,
    });
  }
}

// Cada servidor puede cambiar desde Ajustes los permisos por defecto de un
// comando, así que los de manager se vuelven a comprobar al ejecutarlos.
const MANAGER_COMMANDS = new Set(["vincular", "panel-fichajes"]);

function isManager(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

async function handleCommand(interaction) {
  const name = interaction.commandName;

  if (!interaction.inGuild()) {
    return interaction.reply({ content: "❌ Usa estos comandos dentro del servidor.", flags: MessageFlags.Ephemeral });
  }
  if (MANAGER_COMMANDS.has(name) && !isManager(interaction)) {
    return interaction.reply({
      content: "❌ Este comando es solo para managers (permiso Gestionar servidor).",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (name === "panel-fichajes") {
    await interaction.reply(panelPayload());
    // Se fija el panel para que siempre esté a mano en el canal.
    try {
      const msg = await interaction.fetchReply();
      await msg.pin();
    } catch (err) {
      console.error("No se pudo fijar el panel:", err.message);
      await interaction.followUp({
        content:
          "⚠️ Publiqué el panel pero no pude fijarlo. Dale al bot el permiso **Fijar mensajes** (o Gestionar mensajes) en este canal, o fíjalo a mano.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (name === "vincular") {
    const user = interaction.options.getUser("usuario");
    const chatterId = Number(interaction.options.getString("chatter"));
    const chatter = db.prepare("SELECT id, name FROM chatters WHERE id = ? AND active = 1").get(chatterId);
    if (!chatter) {
      return interaction.reply({ content: "❌ Chatter no encontrado.", flags: MessageFlags.Ephemeral });
    }
    try {
      db.prepare("UPDATE chatters SET discord_id = NULL WHERE discord_id = ?").run(user.id);
      db.prepare("UPDATE chatters SET discord_id = ? WHERE id = ?").run(user.id, chatter.id);
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: "❌ No se pudo vincular.", flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: `✅ ${user} vinculado con el chatter **${chatter.name}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const chatter = chatterFor(interaction.user.id);
  if (!chatter) {
    return interaction.reply({
      content: "❌ Tu usuario de Discord no está vinculado a un chatter. Pedile a un manager que use /vincular.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (name === "uso") {
    const used = getUsedToday(chatter.id);
    const limit = chatter.daily_char_limit || DEFAULT_DAILY_LIMIT;
    return interaction.reply({
      content: `Hoy usaste **${used}/${limit}** caracteres.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const modelId = Number(interaction.options.getString("modelo"));
  if (name === "voz") {
    return replyWithAudio(interaction, chatter, modelId, interaction.options.getString("texto"));
  }
  if (name === "frase") {
    const phrase = db
      .prepare("SELECT text FROM phrases WHERE id = ?")
      .get(Number(interaction.options.getString("frase")));
    if (!phrase) {
      return interaction.reply({ content: "❌ Frase no encontrada.", flags: MessageFlags.Ephemeral });
    }
    return replyWithAudio(interaction, chatter, modelId, phrase.text);
  }
}

async function startDiscordBot() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    console.log("Bot de Discord desactivado (faltan DISCORD_TOKEN / DISCORD_CLIENT_ID).");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID;
  // Con GUILD_ID los comandos aparecen al instante; globales pueden tardar hasta 1 h.
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  // Con comandos de servidor, se vacían los globales para que no aparezcan duplicados.
  if (guildId) await rest.put(Routes.applicationCommands(clientId), { body: [] });

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);
        return await interaction.respond(autocompleteRows(focused.name, focused.value));
      }
      if (interaction.isChatInputCommand()) return await handleCommand(interaction);
      if (interaction.isButton() && interaction.customId.startsWith("shift:")) {
        return await handleShiftButton(interaction);
      }
    } catch (err) {
      console.error("Error en interacción de Discord:", err);
    }
  });

  client.once("clientReady", () => console.log(`Bot de Discord conectado como ${client.user.tag}`));
  await client.login(token);
}

module.exports = { startDiscordBot };
