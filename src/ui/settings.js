// Settings screen: rate, currency, invoice numbering, sales tax, business details.
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { state } from '../state.js';
import { DOCS, defaultSettings } from '../lib/schema.js';
import { TAX_TABLES, CANADA_PROVINCES, formatRatePct, isCustomTaxCountry } from '../domain/tax.js';

function populateProvinceSelect(){
  var sel=$('#taxProvince');
  if(!sel.options.length){ sel.innerHTML = CANADA_PROVINCES.map(function(p){return '<option value="'+esc(p)+'">'+esc(p)+'</option>';}).join(''); }
}
function getFormTaxLines(){
  var country=$('#taxCountry').value;
  if(country==='Canada') return TAX_TABLES[$('#taxProvince').value]||[];
  if(isCustomTaxCountry(country)){
    var out=[];
    var l1=$('#taxLabel1').value.trim(), r1=parseFloat($('#taxRate1').value)||0;
    if(l1 && r1>0) out.push({label:l1, rate:r1/100});
    var l2=$('#taxLabel2').value.trim(), r2=parseFloat($('#taxRate2').value)||0;
    if(l2 && r2>0) out.push({label:l2, rate:r2/100});
    return out;
  }
  return [];
}
function updateTaxPreviewUI(){
  var lines=getFormTaxLines();
  $('#taxPreview').textContent = lines.length ? 'Applied to invoices: '+lines.map(function(t){return t.label+' '+formatRatePct(t.rate)+'%';}).join('  +  ') : 'No tax will be added to invoices.';
}

export function renderSettings(){
  var settings=state.settings;
  $('#setRate').value=settings.rate||'';
  $('#setCurrency').value=settings.currency||'$';
  $('#setNextInv').value=settings.nextInvoiceNumber||1;
  $('#setBizName').value=settings.businessName||'';
  $('#setBizEmail').value=settings.businessEmail||'';
  $('#setBizAddress').value=settings.businessAddress||'';
  $('#setNotes').value=settings.notes||'';

  populateProvinceSelect();
  var country=settings.taxCountry||'';
  $('#taxCountry').value=country;
  $('#taxProvinceField').hidden = country!=='Canada';
  $('#taxCustomFields').hidden = !isCustomTaxCountry(country);
  if(country==='Canada') $('#taxProvince').value=settings.taxRegion||'';
  if(isCustomTaxCountry(country)){
    $('#taxLabel1').value=settings.taxCustomLabel1||''; $('#taxRate1').value = settings.taxCustomRate1 ? formatRatePct(settings.taxCustomRate1) : '';
    $('#taxLabel2').value=settings.taxCustomLabel2||''; $('#taxRate2').value = settings.taxCustomRate2 ? formatRatePct(settings.taxCustomRate2) : '';
  } else {
    $('#taxLabel1').value=''; $('#taxRate1').value=''; $('#taxLabel2').value=''; $('#taxRate2').value='';
  }
  updateTaxPreviewUI();

  $('#setupBanner').hidden = !!(settings.rate && settings.businessName);
}

export function bind(){
  $('#taxCountry').addEventListener('change', function(){
    var c=$('#taxCountry').value;
    $('#taxProvinceField').hidden = c!=='Canada';
    $('#taxCustomFields').hidden = !isCustomTaxCountry(c);
    if(c==='Canada') populateProvinceSelect();
    updateTaxPreviewUI();
  });
  $('#taxProvince').addEventListener('change', updateTaxPreviewUI);
  ['#taxLabel1','#taxRate1','#taxLabel2','#taxRate2'].forEach(function(sel){ $(sel).addEventListener('input', updateTaxPreviewUI); });

  $('#saveSettingsBtn').addEventListener('click', function(){
    if(!state.store) return;
    var country=$('#taxCountry').value;
    var data={
      rate: parseFloat($('#setRate').value)||0, currency:$('#setCurrency').value.trim()||'$',
      nextInvoiceNumber: parseInt($('#setNextInv').value,10)||1,
      businessName:$('#setBizName').value.trim(), businessEmail:$('#setBizEmail').value.trim(),
      businessAddress:$('#setBizAddress').value.trim(), notes:$('#setNotes').value.trim(),
      taxCountry: country,
      taxRegion: country==='Canada' ? $('#taxProvince').value : '',
      taxCustomLabel1: isCustomTaxCountry(country) ? $('#taxLabel1').value.trim() : '',
      taxCustomRate1: isCustomTaxCountry(country) ? (parseFloat($('#taxRate1').value)||0)/100 : 0,
      taxCustomLabel2: isCustomTaxCountry(country) ? $('#taxLabel2').value.trim() : '',
      taxCustomRate2: isCustomTaxCountry(country) ? (parseFloat($('#taxRate2').value)||0)/100 : 0
    };
    state.store.doc(DOCS.settings).set(data).then(function(){ toast('Settings saved.','success'); }).catch(function(err){ toast('Could not save: '+err.message,'error'); });
  });
}

/** onSettingsChanged runs after every settings render (main.js uses it to re-render the invoice preview). */
export function subscribe(onSettingsChanged){
  state.store.doc(DOCS.settings).onSnapshot(function(snap){
    state.settings = Object.assign(defaultSettings(), snap.exists?snap.data():{});
    renderSettings();
    if(onSettingsChanged) onSettingsChanged();
  }, function(err){ toast('Settings error: '+err.message,'error'); });
}
