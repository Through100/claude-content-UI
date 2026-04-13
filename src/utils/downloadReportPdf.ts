import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Rasterizes a DOM subtree to a multi-page A4 PDF (JPEG) and triggers download.
 */
export async function downloadElementAsPdf(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  const marginX = 10;
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const imgW = pdfW - 2 * marginX;
  const imgH = (canvas.height * imgW) / canvas.width;

  let heightLeft = imgH;
  let position = 0;

  pdf.addImage(imgData, 'JPEG', marginX, position, imgW, imgH);
  heightLeft -= pdfH;

  while (heightLeft >= 0) {
    position = heightLeft - imgH;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', marginX, position, imgW, imgH);
    heightLeft -= pdfH;
  }

  pdf.save(filename);
}
