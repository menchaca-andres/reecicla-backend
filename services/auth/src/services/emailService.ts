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
}
