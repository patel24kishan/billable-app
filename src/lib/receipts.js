// Receipt blob interface. Today a receipt is a data URL stored on the expense
// record (receiptData/receiptType/receiptW/receiptH); every reader and writer
// goes through here so it can later point at cloud storage instead.
import { COLLECTIONS } from './schema.js';

export var ACCEPTED_RECEIPT_TYPES={'image/jpeg':true,'image/png':true};
/** Reads an image file, downscales it, and resolves {dataUrl,type,width,height} — keeps stored receipts small. */
export function fileToCompressedDataUrl(file){
  return new Promise(function(resolve,reject){
    if(!ACCEPTED_RECEIPT_TYPES[file.type]){ reject(new Error('Please choose a JPEG or PNG image.')); return; }
    var reader=new FileReader();
    reader.onerror=function(){ reject(new Error('Could not read the file.')); };
    reader.onload=function(){
      var img=new Image();
      img.onerror=function(){ reject(new Error('Could not decode the image.')); };
      img.onload=function(){
        var maxDim=1400;
        var scale=Math.min(1, maxDim/Math.max(img.naturalWidth,img.naturalHeight));
        var w=Math.max(1,Math.round(img.naturalWidth*scale)), h=Math.max(1,Math.round(img.naturalHeight*scale));
        var canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
        var ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
        var outType = file.type==='image/png' ? 'image/png' : 'image/jpeg';
        var dataUrl = outType==='image/jpeg' ? canvas.toDataURL(outType,0.78) : canvas.toDataURL(outType);
        resolve({ dataUrl:dataUrl, type:outType, width:w, height:h });
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** True when the expense has a stored receipt. */
export function hasReceipt(expense){ return !!expense.receiptData; }

/** The stored receipt as {dataUrl,type,width,height} (raw values, no defaults), or null. */
export function getReceipt(expense){
  if(!hasReceipt(expense)) return null;
  return { dataUrl:expense.receiptData, type:expense.receiptType, width:expense.receiptW, height:expense.receiptH };
}

/** The expense fields that store a receipt. */
export function receiptFields(receipt){
  return { receiptData:receipt.dataUrl, receiptType:receipt.type, receiptW:receipt.width, receiptH:receipt.height };
}

/** The expense fields that clear a stored receipt. */
export function clearedReceiptFields(){
  return { receiptData:null, receiptType:null, receiptW:null, receiptH:null };
}

/** Receipt access by expense id, backed by the given store. */
export function createReceipts(store){
  return {
    has: hasReceipt,
    get: getReceipt,
    put: function(expenseId, receipt){ return store.collection(COLLECTIONS.expenses).doc(expenseId).update(receiptFields(receipt)); },
    remove: function(expenseId){ return store.collection(COLLECTIONS.expenses).doc(expenseId).update(clearedReceiptFields()); }
  };
}
