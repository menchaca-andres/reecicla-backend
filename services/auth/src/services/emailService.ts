import nodemailer from 'nodemailer';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} debe estar configurado para verificar correos.`);
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export class EmailService {
  private static createTransporter() {
    const host = requiredEnv('SMTP_HOST');
    const port = Number(requiredEnv('SMTP_PORT'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT debe ser un puerto válido.');
    }
    const from = requiredEnv('SMTP_FROM');
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD?.trim();
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error('SMTP_USER y SMTP_PASSWORD deben configurarse juntos.');
    }
    return {
      from,
      transporter: nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true',
        ...(user && pass ? { auth: { user, pass } } : {}),
      }),
    };
  }

  static async sendGuestVerification(email: string, name: string, code: string): Promise<void> {
    const { from, transporter } = EmailService.createTransporter();
    const safeName = escapeHtml(name);
    await transporter.sendMail({
      from,
      to: email,
      subject: 'Verifica tu correo para aceptar la cotización',
      text: `Hola ${name}, tu código de verificación es ${code}. Vence en 10 minutos.`,
      html: `<p>Hola ${safeName},</p><p>Tu código de verificación es:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Vence en 10 minutos. Si no solicitaste este código, ignora este correo.</p>`,
    });
  }

  static async sendOrderTrackingLink(
    email: string,
    customerName: string,
    orderNumber: string,
    trackingUrl: string
  ): Promise<void> {
    const { from, transporter } = EmailService.createTransporter();
    const safeName = escapeHtml(customerName);
    const safeOrderNumber = escapeHtml(orderNumber);
    const safeTrackingUrl = escapeHtml(trackingUrl);
    await transporter.sendMail({
      from,
      to: email,
      subject: `Seguimiento de tu pedido ${orderNumber}`,
      text: `Hola ${customerName}, puedes consultar el estado de tu pedido ${orderNumber} desde este enlace: ${trackingUrl}. El enlace es privado y vence en 90 días.`,
      html: `<p>Hola ${safeName},</p><p>Tu cotización fue aceptada y el pedido <strong>${safeOrderNumber}</strong> está en proceso.</p><p><a href="${safeTrackingUrl}">Ver estado de mi pedido</a></p><p>Este enlace es privado y vence en 90 días. No lo compartas.</p>`,
    });
  }

  static async sendCatalogMaintenanceSummary(
    email: string,
    adminName: string,
    summary: {
      totalDeactivated: number;
      totalBlocked: number;
      deactivatedItems: Array<{ code: string; name: string; last_received_at?: string; reason: string }>;
      blockedItems: Array<{ code: string; name: string; alert: string }>;
      executedBy: string;
      executedAt: string;
    }
  ): Promise<void> {
    const { from, transporter } = EmailService.createTransporter();
    const safeName = escapeHtml(adminName);
    const rowsHtml = summary.deactivatedItems.length > 0
      ? summary.deactivatedItems.map(item => `
          <tr>
            <td style="padding:8px;border:1px solid #ddd;"><strong>${escapeHtml(item.name)}</strong> (${escapeHtml(item.code)})</td>
            <td style="padding:8px;border:1px solid #ddd;">${item.last_received_at ? new Date(item.last_received_at).toLocaleDateString() : 'Sin recepciones previas'}</td>
            <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(item.reason)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" style="padding:8px;text-align:center;">No se desactivaron tipos.</td></tr>';

    const blockedHtml = summary.blockedItems && summary.blockedItems.length > 0
      ? `<div style="margin-top:16px;background:#fff7ed;padding:12px;border:1px solid #fed7aa;border-radius:6px;">
           <h4 style="color:#c2410c;margin:0 0 8px;">Tipos mantenidos activos por dependencias (Stock o pedidos pendientes - CA03):</h4>
           <ul style="margin:0;padding-left:20px;color:#9a3412;">
             ${summary.blockedItems.map(b => `<li><strong>${escapeHtml(b.name)}</strong>: ${escapeHtml(b.alert)}</li>`).join('')}
           </ul>
         </div>`
      : '';

    await transporter.sendMail({
      from,
      to: email,
      subject: `[Reecicla] Resumen de Mantenimiento de Catálogo (HU-023)`,
      text: `Hola ${adminName}, se ejecutó el proceso de mantenimiento de catálogo (HU-023). Tipos desactivados por inactividad: ${summary.totalDeactivated}.`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1e293b;">
          <h2 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Resumen de Mantenimiento de Catálogo (HU-023)</h2>
          <p>Hola <strong>${safeName}</strong>,</p>
          <p>Se ha ejecutado el proceso de revisión y desactivación de tipos de equipos sin recepciones en los últimos 12 meses.</p>
          <p style="background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0;">
            <strong>Ejecutado por:</strong> ${escapeHtml(summary.executedBy)}<br/>
            <strong>Fecha de ejecución:</strong> ${new Date(summary.executedAt).toLocaleString()}<br/>
            <strong>Total desactivados por inactividad:</strong> <span style="color:#b91c1c;font-weight:bold;">${summary.totalDeactivated}</span><br/>
            <strong>Total protegidos por dependencias activas:</strong> <span style="color:#166534;font-weight:bold;">${summary.totalBlocked}</span>
          </p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Tipo de Equipo</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Última Recepción</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left;">Motivo</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          ${blockedHtml}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px;"/>
          <p style="color:#64748b;font-size:11px;">Reecicla Bolivia — Sistema Automatizado de Gestión de Inventario</p>
        </div>
      `,
    });
  }
}

