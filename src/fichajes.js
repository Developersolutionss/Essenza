const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const shifts = require("./shifts");

const ts = (ms, style = "t") => `<t:${Math.floor(ms / 1000)}:${style}>`;

function fmt(ms) {
  if (ms > 0 && ms < 60000) return `${Math.round(ms / 1000)} s`;
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

// Panel fijo del canal: botones + quién está en turno ahora.
function panelPayload() {
  const open = shifts.listOpen();
  const working = open.filter((o) => !o.onBreak);
  const onBreak = open.filter((o) => o.onBreak);

  const line = (o) =>
    `• <@${o.shift.discord_id}> — desde ${ts(o.shift.started_at)}` +
    (o.onBreak ? ` (break desde ${ts(o.openBreakStartedAt, "R")})` : "");

  const embed = new EmbedBuilder()
    .setTitle("🕐 Fichajes")
    .setColor(0x3e6259)
    .setDescription(
      `Pulsa **Start** para iniciar tu turno.\n` +
        `Debes completar **${fmt(shifts.SHIFT_MS)}** de trabajo efectivo para poder pulsar **End**. ` +
        `Tienes **un solo break** por turno, de **${fmt(shifts.BREAK_MS)}**, y no cuenta como trabajo.`
    )
    .addFields(
      { name: `En turno (${working.length})`, value: working.map(line).join("\n") || "Nadie por ahora." },
      { name: `En break (${onBreak.length})`, value: onBreak.map(line).join("\n") || "Nadie." }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("shift:start").setLabel("Start").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("shift:break").setLabel("Break").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("shift:resume").setLabel("Resume").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("shift:end").setLabel("End").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("shift:status").setLabel("Mi estado").setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function statusText(st) {
  return (
    `Turno desde ${ts(st.shift.started_at)}.\n` +
    `Trabajado: **${fmt(st.workedMs)}** de ${fmt(shifts.SHIFT_MS)}.\n` +
    `Break: **${fmt(st.breakMs)}** de ${fmt(shifts.BREAK_MS)}` +
    (st.onBreak ? " (estás en break ahora)" : "") +
    (st.breakOverMs ? `\n⚠️ Exceso de break: **${fmt(st.breakOverMs)}**.` : "") +
    (st.canEnd
      ? "\n✅ Ya puedes pulsar **End**."
      : st.onBreak
      ? ""
      : `\nPodrás terminar a partir de ${ts(Date.now() + st.remainingMs)} si no haces más breaks.`)
  );
}

function runAction(action, discordId, name) {
  switch (action) {
    case "start": {
      const r = shifts.startShift(discordId, name);
      if (!r.ok) return `❌ Ya tienes un turno abierto desde ${ts(r.shift?.started_at ?? Date.now())}.`;
      return (
        `✅ Turno iniciado a las ${ts(r.shift.started_at)}.\n` +
        `Podrás pulsar **End** cuando acumules ${fmt(shifts.SHIFT_MS)} de trabajo (sin contar breaks), ` +
        `aprox. ${ts(r.shift.started_at + shifts.SHIFT_MS)}.`
      );
    }
    case "break": {
      const r = shifts.startBreak(discordId);
      if (!r.ok) {
        if (r.reason === "no_shift") return "❌ No tienes un turno abierto. Pulsa **Start** primero.";
        if (r.reason === "break_used") return "❌ Ya usaste tu break de este turno. Solo se permite uno por turno.";
        return "❌ Ya estás en break. Pulsa **Resume** cuando vuelvas.";
      }
      if (r.remainingBreakMs <= 0) {
        return "☕ Break iniciado, pero ya agotaste tu tiempo de break. Todo lo que uses quedará marcado como exceso.";
      }
      return `☕ Break iniciado. Te quedan **${fmt(r.remainingBreakMs)}**; vuelve antes de ${ts(Date.now() + r.remainingBreakMs)} y pulsa **Resume**.`;
    }
    case "resume": {
      const r = shifts.endBreak(discordId);
      if (!r.ok) {
        return r.reason === "no_shift"
          ? "❌ No tienes un turno abierto."
          : "❌ No estás en break.";
      }
      return r.st.breakOverMs
        ? `⚠️ Volviste del break con **${fmt(r.st.breakOverMs)}** de exceso. Quedó registrado para los administradores.`
        : `▶️ De vuelta al trabajo. Ese era tu único break de este turno.`;
    }
    case "end": {
      const r = shifts.endShift(discordId);
      if (!r.ok) {
        if (r.reason === "no_shift") return "❌ No tienes un turno abierto.";
        if (r.reason === "on_break") return "❌ Estás en break. Pulsa **Resume** y luego **End**.";
        return (
          `⛔ Aún no puedes terminar. Llevas **${fmt(r.st.workedMs)}** de ${fmt(shifts.SHIFT_MS)}; ` +
          `te faltan **${fmt(r.st.remainingMs)}** (a partir de ${ts(Date.now() + r.st.remainingMs)} si no haces más breaks).`
        );
      }
      return `🏁 Turno terminado. Trabajado: **${fmt(r.workedMs)}**. Break: **${fmt(r.breakMs)}**` +
        (r.breakOverMs ? ` (exceso ${fmt(r.breakOverMs)})` : "") + ".";
    }
    case "status": {
      const st = shifts.statusOf(discordId);
      return st ? statusText(st) : "No tienes un turno abierto. Pulsa **Start** para empezar.";
    }
    default:
      return "Acción desconocida.";
  }
}

async function handleShiftButton(interaction) {
  const action = interaction.customId.split(":")[1];
  const name = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  const text = runAction(action, interaction.user.id, name);
  // Primero se refresca el panel del canal y luego se responde en privado.
  await interaction.update(panelPayload());
  await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
}

module.exports = { panelPayload, handleShiftButton };
