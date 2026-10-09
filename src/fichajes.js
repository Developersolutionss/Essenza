const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const shifts = require("./shifts");
const plans = require("./shiftPlan");

const ts = (ms, style = "t") => `<t:${Math.floor(ms / 1000)}:${style}>`;

function fmt(ms) {
  if (ms > 0 && ms < 60000) return `${Math.round(ms / 1000)} s`;
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Panel fijo del canal: botones + quién está en turno ahora.
function panelPayload() {
  const open = shifts.listOpen();
  const working = open.filter((o) => !o.onBreak);
  const onBreak = open.filter((o) => o.onBreak);

  const line = (o) =>
    `• <@${o.shift.discord_id}> — desde ${ts(o.shift.started_at)}` +
    (o.onBreak ? ` (break desde ${ts(o.openBreakStartedAt, "R")})` : "");

  // Un campo de embed admite 1024 caracteres: con mucha gente en turno hay que
  // recortar la lista, o Discord rechaza la actualización y nadie ve respuesta.
  const fieldValue = (list) => {
    if (!list.length) return "Nadie por ahora.";
    const lines = [];
    let used = 0;
    for (let i = 0; i < list.length; i++) {
      const l = line(list[i]);
      const rest = list.length - i;
      const tail = "…y " + rest + " más";
      if (used + l.length + 1 + tail.length > 1024) {
        lines.push(tail);
        break;
      }
      lines.push(l);
      used += l.length + 1;
    }
    return lines.join("\n").slice(0, 1024);
  };

  const embed = new EmbedBuilder()
    .setTitle("🕐 Fichajes")
    .setColor(0x3e6259)
    .setDescription(
      `Pulsa **Start** para iniciar tu turno. Podrás pulsar **End** al cumplir la duración de tu turno ` +
        `(hora de Venezuela):\n${turnosText()}\n` +
        `Tienes **un solo break** por turno, de **${fmt(shifts.BREAK_MS)}**: cuenta como trabajado, ` +
        `pero si te pasas, el exceso se descuenta y tienes que recuperarlo.`
    )
    .addFields(
      { name: `En turno (${working.length})`, value: fieldValue(working) },
      { name: `En break (${onBreak.length})`, value: onBreak.length ? fieldValue(onBreak) : "Nadie." }
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

// "05:30" + 450 min -> "13:00" (pasa la medianoche si hace falta).
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// Lista de turnos para el panel: "• Shift 1: 05:30 a 13:00 (7 h 30 min)".
function turnosText() {
  const list = plans.listTemplates();
  if (!list.length) return `• Turno general: ${fmt(shifts.SHIFT_MS)}`;
  return list
    .map((t) => {
      const min = t.durationMin || shifts.SHIFT_MS / 60000;
      return `• ${t.name}: ${t.startTime} a ${addMinutes(t.startTime, min)} (${fmt(min * 60000)})`;
    })
    .join("\n");
}

function statusText(st) {
  return (
    `Turno desde ${ts(st.shift.started_at)}` +
    (st.shift.template_name ? ` (${st.shift.template_name})` : "") +
    `.\n` +
    `Trabajado: **${fmt(st.workedMs)}** de ${fmt(st.requiredMs)}.\n` +
    `Break: **${fmt(st.breakMs)}** de ${fmt(shifts.BREAK_MS)}` +
    (st.onBreak ? " (estás en break ahora)" : "") +
    (st.breakOverMs ? `\n⚠️ Exceso de break: **${fmt(st.breakOverMs)}**.` : "") +
    (st.canEnd
      ? "\n✅ Ya puedes pulsar **End**."
      : st.onBreak
      ? ""
      : `\nPodrás terminar a partir de ${ts(Date.now() + st.remainingMs)}.`)
  );
}

// `names`: textos de la persona donde buscar su turno (apodo del servidor, nombre, roles).
function runAction(action, discordId, name, names = []) {
  switch (action) {
    case "start": {
      const now = Date.now();
      const plan = plans.resolveForStart({ discordId, names, startedAt: now });
      const r = shifts.startShift(discordId, name, now, plan);
      if (!r.ok) return `❌ Ya tienes un turno abierto desde ${ts(r.shift?.started_at ?? Date.now())}.`;

      const requiredMs = shifts.statusOf(discordId, now)?.requiredMs ?? shifts.SHIFT_MS;
      let msg =
        `✅ Turno iniciado a las ${ts(r.shift.started_at)}.\n` +
        `Podrás pulsar **End** a las ${ts(r.shift.started_at + requiredMs)}, al cumplir ${fmt(requiredMs)} ` +
        `(el break de ${fmt(shifts.BREAK_MS)} cuenta; solo se suma lo que te pases).`;

      if (plan?.source === "exento") {
        msg += `\nℹ️ Tu cargo no sigue un turno fijo, así que no se mide tu puntualidad. Tu jornada es de **${fmt(requiredMs)}**.`;
      } else if (plan) {
        const quien =
          plan.source === "personal" ? "tu horario personal" : `**${plan.templateName}**`;
        const lateMs = Math.max(0, r.shift.started_at - plan.expectedAt);
        // La hora de entrada se muestra con el formato de Discord: cada persona la ve
        // en su propio reloj (en Colombia las 12:00, en Argentina las 14:00...).
        msg += `\n📋 Turno: ${quien}${plan.source === "hora" ? " (deducido por tu hora de entrada)" : ""}.`;
        msg += ` Entrada: ${ts(plan.expectedAt)} en tu hora (${plan.startTime}, ${plans.tzLabel()}). `;
        msg += lateMs > plan.graceMin * 60000
          ? `⚠️ Llegaste **${fmt(lateMs)}** tarde.`
          : "Llegaste a tiempo.";
      } else {
        msg += "\nℹ️ No pude deducir tu turno, así que hoy no se mide tu puntualidad.";
      }
      return msg;
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
          `⛔ Aún no puedes terminar. Llevas **${fmt(r.st.workedMs)}** de ${fmt(r.st.requiredMs)}; ` +
          `te faltan **${fmt(r.st.remainingMs)}** (a partir de ${ts(Date.now() + r.st.remainingMs)}).`
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
  // El turno sale del apodo del servidor ("Ana - Shift 2 (Chatter)"); si no está
  // ahí, se prueba con el nombre global y con los roles.
  const roleNames = interaction.member?.roles?.cache
    ? [...interaction.member.roles.cache.values()].map((r) => r.name)
    : [];
  const names = [name, interaction.user.globalName, ...roleNames];
  const text = runAction(action, interaction.user.id, name, names);

  // La acción ya quedó guardada en la base: pase lo que pase con el panel del
  // canal, la persona tiene que recibir su confirmación.
  try {
    await interaction.update(panelPayload());
    await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("No se pudo refrescar el panel de fichajes:", err.message);
    const reply = { content: text, flags: MessageFlags.Ephemeral };
    const send = interaction.replied || interaction.deferred
      ? interaction.followUp(reply)
      : interaction.reply(reply);
    await send.catch(() => {});
  }
}

module.exports = { panelPayload, handleShiftButton, runAction };
