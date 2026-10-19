import PDFDocument from 'pdfkit';
import { PaymentMethod } from '../types/payment';

export interface PaymentReceiptDetails {
  paymentId: string;
  tenantId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paidByUserId: string;
  paidByUserName?: string;
  paidAt: Date;
}

export function generatePaymentReceipt(details: PaymentReceiptDetails): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 56,
      compress: false,
      info: {
        Title: `Comprobante Reecicla ${details.paymentId}`,
        Author: 'Reecicla',
        Subject: `Pago de orden ${details.orderNumber}`,
        CreationDate: details.paidAt,
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.once('error', reject);
    document.once('end', () => resolve(Buffer.concat(chunks)));

    const paymentMethod = details.method === 'CHECK' ? 'Cheque' : 'Transferencia bancaria';
    const paidAt = new Intl.DateTimeFormat('es-BO', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/La_Paz',
    }).format(details.paidAt);

    document.font('Helvetica-Bold').fontSize(22).text('REECICLA', { align: 'center' });
    document.moveDown(0.5);
    document.font('Helvetica-Bold').fontSize(16).text('Comprobante de pago registrado', { align: 'center' });
    document.moveDown(1.5);
    document.font('Helvetica').fontSize(11);
    document.text('Este documento acredita que Reecicla registró el desembolso indicado.');
    document.text('No reemplaza el comprobante emitido por el banco ni confirma su liquidación.');
    document.moveDown();
    document.font('Helvetica-Bold').text('Detalle del pago');
    document.moveDown(0.5);
    document.font('Helvetica');
    document.text(`Orden: ${details.orderNumber}`);
    document.text(`Identificador del pago: ${details.paymentId}`);
    document.text(`Monto: ${details.currency} ${details.amount.toFixed(2)}`);
    document.text(`Método: ${paymentMethod}`);
    document.text(`Referencia externa: ${details.reference || 'No proporcionada'}`);
    document.text('Estado en Reecicla: COMPLETED');
    document.text(`Registrado el: ${paidAt} (hora de Bolivia)`);
    document.text(`Registrado por: ${details.paidByUserName || 'Usuario del negocio'}`);
    document.text(`Identificador del usuario: ${details.paidByUserId}`);
    document.text(`Negocio: ${details.tenantId}`);
    document.moveDown(2);
    document.fontSize(9).fillColor('#555555')
      .text('Conserve este comprobante junto con cualquier constancia bancaria disponible.');
    document.end();
  });
}
