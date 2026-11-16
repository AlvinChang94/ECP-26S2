// What: draws a proforma invoice (PI) as a PDF from already-approved order data.
// Who calls it: the PI download route (story 2) and the sample-data generator (sample PI documents).
// To extend: change the layout here. Bank details are deliberately not printed: the real ones live in Navision.
import { displayMoney } from "@/domain/money";
import { PdfWriter } from "./pdfWriter";

export type ProformaInvoiceData = {
  piNumber: string;
  piDate: string; // as it should be printed, for example "2026-11-16"
  sellerName: string;
  customerName: string;
  poNumber: string;
  currency: string;
  paymentTerms: string;
  lines: { itemNo: string; description: string; quantity: number; unitPrice: string; lineTotal: string }[];
  totalAmount: string;
};

export async function renderProformaInvoice(data: ProformaInvoiceData, footer: string): Promise<Uint8Array> {
  const pdf = await PdfWriter.create({ title: `Proforma invoice ${data.piNumber}`, footer });
  pdf.text(pdf.left, 48, data.sellerName, { size: 14, bold: true });
  pdf.text(330, 48, "PROFORMA INVOICE", { size: 16, bold: true });

  pdf.labelValue(pdf.left, 100, "PI Number", data.piNumber);
  pdf.labelValue(330, 100, "PI Date", data.piDate);
  pdf.labelValue(pdf.left, 116, "Customer", data.customerName);
  pdf.labelValue(330, 116, "PO Reference", data.poNumber);
  pdf.labelValue(pdf.left, 132, "Currency", data.currency);
  pdf.labelValue(330, 132, "Payment terms", data.paymentTerms);

  const bottom = pdf.table(
    176,
    [
      { header: "Part No", width: 90 },
      { header: "Description", width: 215 },
      { header: "Qty", width: 55 },
      { header: "Unit Price", width: 70 },
      { header: "Amount", width: 69 },
    ],
    data.lines.map((line) => [
      line.itemNo,
      line.description,
      String(line.quantity),
      displayMoney(line.unitPrice),
      displayMoney(line.lineTotal),
    ]),
  );
  pdf.labelValue(330, bottom + 6, "Total", displayMoney(data.totalAmount));
  pdf.text(pdf.left, bottom + 44, "Bank details: taken from Navision in the real system. Not part of this proof of concept.", {
    size: 9,
    grey: true,
  });
  return pdf.save();
}
