import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Resend } from "resend";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "MiCasa <notificaciones@micasa.app>";

type EmailType =
  | "invitacion_casa"
  | "bienvenida"
  | "recordatorio_cita"
  | "aviso_presupuesto"
  | "cumpleanos";

interface DataInvitacionCasa {
  inviterName: string;
  casaName: string;
  inviteCode: string;
}

interface DataBienvenida {
  name: string;
}

interface DataRecordatorioCita {
  name: string;
  title: string;
  when: string;
  location?: string;
}

interface DataAvisoPresupuesto {
  sectionName: string;
  spent: number;
  budget: number;
  month: string;
}

interface DataCumpleanos {
  contactName: string;
  birthDate: string;
}

type EmailData =
  | DataInvitacionCasa
  | DataBienvenida
  | DataRecordatorioCita
  | DataAvisoPresupuesto
  | DataCumpleanos;

interface EmailRequest {
  to: string;
  type: EmailType;
  data: EmailData;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_LEN = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function str(v: unknown, label: string, max = MAX_LEN): string | undefined {
  if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
    return `${label} invalido`;
  }
  return undefined;
}

function num(v: unknown, label: string): number | undefined {
  if (typeof v !== "number" || Number.isNaN(v) || v < 0) {
    return `${label} invalido`;
  }
  return undefined;
}

function parseRequest(body: unknown): { ok: true; req: EmailRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body invalido" };
  }
  const b = body as Record<string, unknown>;
  const toErr = str(b.to, "to");
  if (toErr) return { ok: false, error: toErr };
  const to = (b.to as string).trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "email invalido" };

  const type = b.type;
  if (
    typeof type !== "string" ||
    !["invitacion_casa", "bienvenida", "recordatorio_cita", "aviso_presupuesto", "cumpleanos"].includes(type)
  ) {
    return { ok: false, error: "tipo invalido" };
  }
  const data = b.data;
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "data invalido" };
  }
  const d = data as Record<string, unknown>;

  let validated: EmailData;
  switch (type) {
    case "invitacion_casa": {
      const e = str(d.inviterName, "inviterName") ?? str(d.casaName, "casaName", 100) ?? str(d.inviteCode, "inviteCode", 32);
      if (e) return { ok: false, error: e };
      validated = {
        inviterName: d.inviterName as string,
        casaName: d.casaName as string,
        inviteCode: d.inviteCode as string,
      };
      break;
    }
    case "bienvenida": {
      const e = str(d.name, "name");
      if (e) return { ok: false, error: e };
      validated = { name: d.name as string };
      break;
    }
    case "recordatorio_cita": {
      const e = str(d.name, "name") ?? str(d.title, "title") ?? str(d.when, "when");
      if (e) return { ok: false, error: e };
      validated = {
        name: d.name as string,
        title: d.title as string,
        when: d.when as string,
        location: typeof d.location === "string" ? d.location : undefined,
      };
      break;
    }
    case "aviso_presupuesto": {
      const e = str(d.sectionName, "sectionName", 100) ?? str(d.month, "month", 40) ?? num(d.spent, "spent") ?? num(d.budget, "budget");
      if (e) return { ok: false, error: e };
      validated = {
        sectionName: d.sectionName as string,
        spent: d.spent as number,
        budget: d.budget as number,
        month: d.month as string,
      };
      break;
    }
    case "cumpleanos": {
      const e = str(d.contactName, "contactName") ?? str(d.birthDate, "birthDate", 40);
      if (e) return { ok: false, error: e };
      validated = { contactName: d.contactName as string, birthDate: d.birthDate as string };
      break;
    }
    default:
      return { ok: false, error: "tipo invalido" };
  }

  return { ok: true, req: { to, type: type as EmailType, data: validated } };
}

function layout(markup: string): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f5f3f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#2f3a4f;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:700;">🏠 MiCasa</td></tr>
        <tr><td style="padding:28px;color:#2f3a4f;font-size:15px;line-height:1.6;">${markup}</td></tr>
        <tr><td style="padding:16px 28px;background:#faf9fb;color:#8a8a93;font-size:12px;">MiCasa — gestiona tu hogar en familia. Cero coste.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const esc = (v: string | undefined | null): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const templates: Record<EmailType, (d: EmailData) => { subject: string; html: string }> = {
  invitacion_casa: (d) => {
    const data = d as DataInvitacionCasa;
    const inviterName = esc(data.inviterName);
    const casaName = esc(data.casaName);
    return {
      subject: `${data.inviterName} te invita a ${data.casaName} en MiCasa`,
      html: layout(`
        <p><strong>${inviterName}</strong> te ha invitado a unirte a la casa <strong>${casaName}</strong>.</p>
        <p>Tu código de invitación:</p>
        <p style="background:#f0ecf5;border-radius:10px;padding:12px 16px;font-size:22px;letter-spacing:4px;font-weight:700;text-align:center;">${esc(data.inviteCode)}</p>
        <p>Abre MiCasa, pulsa "Unirme a una casa" e introduce el código.</p>
      `),
    };
  },
  bienvenida: (d) => {
    const data = d as DataBienvenida;
    const name = esc(data.name);
    return {
      subject: `Bienvenido a MiCasa, ${data.name}`,
      html: layout(`
        <p>¡Hola, <strong>${name}</strong>!</p>
        <p>Tu cuenta MiCasa está lista. Crea una casa o únete con el código de un familiar para empezar a compartir gastos, citas y listas de la compra.</p>
      `),
    };
  },
  recordatorio_cita: (d) => {
    const data = d as DataRecordatorioCita;
    const title = esc(data.title);
    const when = esc(data.when);
    const location = esc(data.location);
    const name = esc(data.name);
    return {
      subject: `Recordatorio: ${data.title} — ${data.when}`,
      html: layout(`
        <p>Hola <strong>${name}</strong>,</p>
        <p>Recuerda tu cita:</p>
        <p><strong>${title}</strong> · ${when}${location ? ` · ${location}` : ""}</p>
      `),
    };
  },
  aviso_presupuesto: (d) => {
    const data = d as DataAvisoPresupuesto;
    const pct = data.budget > 0 ? Math.round((data.spent / data.budget) * 100) : 0;
    const money = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
    const sectionName = esc(data.sectionName);
    const month = esc(data.month);
    return {
      subject: `${data.month}: ${data.sectionName} al ${pct}% del presupuesto`,
      html: layout(`
        <p>Gasto en <strong>${sectionName}</strong> (${month}):</p>
        <p style="font-size:20px;"><strong>${money(data.spent)}</strong> de ${money(data.budget)} · ${pct}%</p>
        ${pct >= 100 ? `<p style="color:#b3412b;">Has superado el presupuesto de esta sección.</p>` : pct >= 80 ? `<p style="color:#b3792b;">Vas camino de superar el presupuesto.</p>` : ""}
      `),
    };
  },
  cumpleanos: (d) => {
    const data = d as DataCumpleanos;
    const contactName = esc(data.contactName);
    const birthDate = esc(data.birthDate);
    return {
      subject: `🎂 Cumpleaños: ${data.contactName} (${data.birthDate})`,
      html: layout(`
        <p>¡No olvides felicitar a <strong>${contactName}</strong>!</p>
        <p>Su cumpleaños es el <strong>${birthDate}</strong>.</p>
      `),
    };
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!RESEND_API_KEY) return json({ error: "resend_not_configured" }, 500);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const tpl = templates[parsed.req.type](parsed.req.data);
  const resend = new Resend(RESEND_API_KEY);
  const res = await resend.emails.send({
    from: FROM_EMAIL,
    to: [parsed.req.to],
    subject: tpl.subject,
    html: tpl.html,
  });

  if (res.error) return json({ error: res.error.message }, 502);
  return json({ ok: true, id: res.data?.id });
});