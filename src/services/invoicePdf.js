// Builds the invoice PDF from an invoice snapshot. No DOM, no store.
import { jsPDF } from 'jspdf';
import 'jspdf-autotable'; // patches jsPDF.prototype.autoTable
import { fmtDateShort, monthLabel } from '../domain/dates.js';
import { formatRatePct } from '../domain/tax.js';

export function buildPdfDoc(invoiceDoc){
  var doc = new jsPDF({ unit:'pt', format:'letter' });
  var pageWidth = doc.internal.pageSize.getWidth();
  var margin = 48;

  doc.setFont('helvetica','bold'); doc.setFontSize(20);
  doc.text('INVOICE', margin, 64);

  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text('Invoice #'+invoiceDoc.number, margin, 82);
  doc.text('Date: '+new Date(invoiceDoc.generatedAt).toLocaleDateString(), margin, 96);
  doc.text('Period: '+monthLabel(invoiceDoc.month), margin, 110);

  doc.setTextColor(30); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text(invoiceDoc.from.name || 'Your Business', pageWidth-margin, 64, {align:'right'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  var y=78;
  (invoiceDoc.from.email? [invoiceDoc.from.email]:[]).concat((invoiceDoc.from.address||'').split('\n').filter(Boolean)).forEach(function(line){
    doc.text(line, pageWidth-margin, y, {align:'right'}); y+=13;
  });

  // B6: the BILL TO block flows below the business details, so a long business address cannot run into it.
  var billY=Math.max(140, y+20);
  doc.setDrawColor(225); doc.line(margin,billY-14,pageWidth-margin,billY-14);
  doc.setTextColor(30); doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('BILL TO', margin, billY);
  doc.setFont('helvetica','normal'); doc.setFontSize(10.5);
  doc.text(invoiceDoc.to.name||'Client', margin, billY+16);
  doc.setFontSize(9.5); doc.setTextColor(90);
  var y2=billY+30;
  (invoiceDoc.to.email? [invoiceDoc.to.email]:[]).concat((invoiceDoc.to.address||'').split('\n').filter(Boolean)).forEach(function(line){
    doc.text(line, margin, y2); y2+=12;
  });

  var rows = invoiceDoc.lineItems.map(function(li){
    return [fmtDateShort(li.date), (li.description||'—')+(li.type==='expense'?'  (expense)':''), li.type==='expense'?'—':li.hours.toFixed(2), invoiceDoc.currency+li.amount.toFixed(2)];
  });
  var grandTotalDisplay = (invoiceDoc.grandTotal!=null ? invoiceDoc.grandTotal : invoiceDoc.totalAmount);
  // B5: each foot label spans the first three columns (right-aligned), so tax labels such as
  // "QST (9.975%)" stay on one line instead of wrapping inside the 60 pt Hours column.
  function footRow(label, amount){
    return [{content:label, colSpan:3, styles:{halign:'right'}}, {content:amount, styles:{halign:'right'}}];
  }
  var footRows=[footRow('Subtotal', invoiceDoc.currency+invoiceDoc.totalAmount.toFixed(2))];
  (invoiceDoc.taxLines||[]).forEach(function(t){
    footRows.push(footRow(t.label+' ('+formatRatePct(t.rate)+'%)', invoiceDoc.currency+t.amount.toFixed(2)));
  });
  footRows.push(footRow('Total due', invoiceDoc.currency+grandTotalDisplay.toFixed(2)));
  doc.autoTable({
    startY: Math.max(y2,billY+40)+16,
    margin:{left:margin,right:margin},
    head:[['Date','Description','Hours', 'Amount']],
    body: rows,
    styles:{ font:'helvetica', fontSize:9.5, textColor:40, cellPadding:6 },
    headStyles:{ fillColor:[52,82,225], textColor:255, fontStyle:'bold' },
    columnStyles:{ 2:{halign:'right',cellWidth:60}, 3:{halign:'right',cellWidth:80} },
    foot: footRows,
    showFoot: 'lastPage', // B4: totals once, at the end of the table (the default repeats them on every page)
    footStyles:{ fillColor:[247,248,250], textColor:20, fontStyle:'bold' },
    didParseCell: function(data){
      // Only the very last foot row ("Total due") should read as the bold grand total; the rest are plain.
      if(data.section==='foot' && data.row.index < footRows.length-1){ data.cell.styles.fontStyle='normal'; data.cell.styles.fillColor=[255,255,255]; }
    }
  });

  // B4: keep the rate line and the notes inside the page. If the block does not fit below the table,
  // it starts on a new page (unless it would not fit on a fresh page either, then it starts here),
  // and the notes continue onto further pages line by line.
  var pageBottom = doc.internal.pageSize.getHeight() - margin;
  var finalY = doc.lastAutoTable.finalY + 26;
  doc.setFontSize(9); doc.setTextColor(90); doc.setFont('helvetica','normal');
  var notesLines = invoiceDoc.notes ? doc.splitTextToSize(invoiceDoc.notes, pageWidth-margin*2) : [];
  var lineH = doc.getFontSize()*doc.getLineHeightFactor();
  var blockH = notesLines.length ? 20 + (notesLines.length-1)*lineH : 0;
  if(finalY + blockH > pageBottom && (finalY > pageBottom || margin + blockH <= pageBottom)){
    doc.addPage();
    finalY = margin;
  }
  doc.text('Rate: '+invoiceDoc.currency+invoiceDoc.rate.toFixed(2)+' / hour  ·  Total hours: '+invoiceDoc.totalHours.toFixed(2), margin, finalY);
  var ny = finalY + 20;
  notesLines.forEach(function(line){
    if(ny > pageBottom){ doc.addPage(); ny = margin; }
    doc.text(line, margin, ny);
    ny += lineH;
  });

  // Receipts: one per page, appended after the invoice itself, so the PDF doubles as its own expense-backup packet.
  (invoiceDoc.receipts||[]).forEach(function(r){
    doc.addPage();
    var pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30);
    doc.text('Receipt — '+r.title, margin, margin);
    var availW=pageWidth-margin*2, availH=pageHeight-margin*2-24;
    var scale=Math.min(availW/r.width, availH/r.height, 1);
    var drawW=r.width*scale, drawH=r.height*scale;
    var left=margin+(availW-drawW)/2, top=margin+24;
    var fmt = r.type==='image/png' ? 'PNG' : 'JPEG';
    try{ doc.addImage(r.dataUrl, fmt, left, top, drawW, drawH); }catch(e){ /* skip a receipt that fails to embed rather than aborting the whole invoice */ }
  });

  return doc;
}
