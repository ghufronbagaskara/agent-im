import fs from "fs";

import PDFDocument from "pdfkit";

export function meetingNotesPdf(note, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(outPath);

    doc.pipe(stream);
    doc
      .fontSize(16)
      .text(`Meeting Notes - ${note.meeting_date}`, { underline: true });
    doc.moveDown();

    const clientSafe = note.summary_md.split(/###\s*CEO Notes/i)[0].trim();
    doc.fontSize(11).text(clientSafe, { align: "left" });
    doc.end();

    stream.on("finish", () => resolve(outPath));
    stream.on("error", reject);
  });
}
