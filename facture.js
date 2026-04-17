require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");
const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

// ── NUMÉROTATION AUTOMATIQUE ──────────────────────────────────────────────
function getNextNumero() {
  const counterFile = path.join(__dirname, 'compteur_facture.json');
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const prefix = `FA-20${year}${month}`;
  let counter = { prefix, num: 0 };
  try {
    counter = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    if (counter.prefix !== prefix) counter = { prefix, num: 0 };
  } catch(e) {}
  counter.num += 1;
  fs.writeFileSync(counterFile, JSON.stringify(counter), 'utf8');
  return `${prefix}-${String(counter.num).padStart(3, '0')}`;
}

const GRILLE = {
  '1. Déplacement & Main d\'oeuvre': {
    'Déplacement Paris intra-muros': 50,
    'Déplacement banlieue < 20km': 80,
    'Déplacement banlieue > 20km (78/91/95)': 100,
    'Main d\'oeuvre / heure supplémentaire': 70,
    'Urgence jour (intervention immédiate)': 130,
    'Urgence soir (18h-22h)': 165,
    'Urgence nuit / week-end / férié': 220,
  },
  '2. Appareillage — Prises & Interrupteurs': {
    'Prise standard': 90, 'Prise spécialisée cuisinière 32A': 140,
    'Prise étanche extérieure IP44': 110, 'Interrupteur simple': 90,
    'Interrupteur va-et-vient': 110, 'Variateur / interrupteur connecté': 130,
  },
  '3. Éclairage & Luminaires': {
    'Luminaire simple (plafonnier, applique)': 115, 'Lustre / luminaire lourd': 200,
    'Spot encastré (unité)': 75, 'Bandeau LED (par ml)': 60,
    'Point lumineux DCL': 100, 'Éclairage extérieur': 150,
  },
  '4. Tableau Électrique & Protections': {
    'Disjoncteur standard': 150, 'Disjoncteur différentiel 30mA type AC': 150,
    'Interrupteur différentiel 63A type A': 250, 'Mini tableau normes NF C 15-100': 185,
    'Remplacement tableau complet 1 rangée': 1050,
    'Remplacement tableau complet 2 rangées': 1850,
    'Remplacement tableau complet 3 rangées': 2500,
    'Ajout module tableau existant': 90,
  },
  '5. Dépannage & Recherche de Panne': {
    'Recherche de panne électrique': 120, 'Réparation court-circuit': 125,
    'Réactivation coupure': 90, 'Diagnostic complet installation': 150,
    'Recherche fuite de courant': 130,
  },
  '6. Mise aux Normes & Sécurité': {
    'Mise à la terre complète': 650, 'Liaison équipotentielle principale': 160,
    'Liaison équipotentielle salle de bain': 140, 'Détecteur de fumée DAAF': 85,
    'Diagnostic électrique obligatoire': 150,
  },
  '7. Circuits & Câblage': {
    'Création circuit apparent 5m': 200, 'Création circuit encastré 5m': 300,
    'Tirage câble supplémentaire (par ml)': 20, 'Pose goulotte/moulure (par ml)': 15,
  },
  '8. Équipements Divers': {
    'Pose interphone audio': 500, 'Pose visiophone': 900,
    'Raccordement chauffe-eau électrique': 250, 'Installation borne IRVE 7kW': 1500,
    'Pose prise borne recharge Green Up': 300,
  },
};

async function genererDetails(lignes, description) {
  const result = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Tu es SINELEC PARIS, electricien professionnel Paris IDF.
Prestations facturees : ${lignes.map((l,i) => `${i+1}. ${l.designation}`).join(' | ')}
Travaux : ${description}

Pour chaque prestation, genere 3 sous-lignes COURTES style BTP professionnel.
Maximum 8 mots par detail. Style telegraphique.

Reponds UNIQUEMENT JSON :
{"lignes_detail":[{"designation":"NOM EXACT","details":["detail1","detail2","detail3"]}]}`
    }]
  });
  const jsonMatch = result.content[0].text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return null;
}

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('     SINELEC PARIS — GÉNÉRATEUR FACTURE');
  console.log('══════════════════════════════════════════\n');

  const numFacture = getNextNumero();
  console.log(`📋 N° Facture : ${numFacture}\n`);

  const client_nom  = await ask('Nom du client         : ');
  const adresse     = await ask('Adresse du client     : ');
  const description = await ask('Décris les travaux réalisés : ');

  // Type de facture
  console.log('\nType de facture :');
  console.log('  1. Facture standard (travaux terminés)');
  console.log('  2. Facture acompte (40%)');
  console.log('  3. Facture sous-traitance (autoliquidation TVA)');
  const typeChoix = await ask('\nChoix (1/2/3) : ');
  const typeFacture = typeChoix === '2' ? 'acompte' : typeChoix === '3' ? 'soustrait' : 'standard';

  const today = new Date();
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const dateStr = fmt(today);

  // Prestations
  const lignes = [];
  while (true) {
    console.log('\n─── CATÉGORIES ───────────────────────────');
    const cats = Object.keys(GRILLE);
    cats.forEach((cat, i) => console.log(`  ${i+1}. ${cat}`));
    console.log('  0. Prestation personnalisée\n  Entrée = terminer\n');

    const catChoix = await ask('Catégorie : ');
    if (!catChoix.trim()) break;

    if (catChoix === '0') {
      const desig = await ask('  Désignation : ');
      const prix = parseFloat(await ask('  Prix HT (€) : '));
      const qte = parseFloat(await ask('  Quantité : '));
      lignes.push({ designation: desig, qte, prixUnit: prix, total: qte * prix });
      continue;
    }

    const catIdx = parseInt(catChoix) - 1;
    if (catIdx < 0 || catIdx >= cats.length) { console.log('  ⚠ Invalide'); continue; }
    const cat = cats[catIdx];
    const prestations = Object.entries(GRILLE[cat]);
    console.log(`\n─── ${cat} ───`);
    prestations.forEach(([nom, prix], i) =>
      console.log(`  ${String(i+1).padStart(2)}. ${nom.padEnd(45)} ${prix} €`));

    const prestChoix = await ask('\nNuméro prestation : ');
    if (!prestChoix.trim()) continue;
    const prestIdx = parseInt(prestChoix) - 1;
    if (prestIdx < 0 || prestIdx >= prestations.length) { console.log('  ⚠ Invalide'); continue; }
    const [nom, prix] = prestations[prestIdx];
    const qte = parseFloat(await ask(`  Quantité pour "${nom}" : `));
    lignes.push({ designation: nom, qte, prixUnit: prix, total: qte * prix });
    console.log(`  ✅ ${nom} × ${qte} = ${(qte * prix).toFixed(2)} €`);
  }

  if (lignes.length === 0) { rl.close(); console.log('\n❌ Aucune prestation.'); return; }

  const totalHT = lignes.reduce((s, l) => s + l.total, 0);
  const montantAcompte = typeFacture === 'acompte' ? totalHT : 0;

  console.log('\n⏳ Claude génère les détails...');
  let detailsData = null;
  try {
    detailsData = await genererDetails(lignes, description);
    if (detailsData && detailsData.lignes_detail) {
      console.log('✅ Détails générés !');
      detailsData.lignes_detail.forEach((l, i) => {
        console.log(`\n  ${i+1}. ${l.designation}`);
        l.details.forEach(d => console.log(`     • ${d}`));
      });
    }
  } catch(e) { console.log('⚠ Claude API non disponible.'); }

  const corriger = await ask('\nLes détails te conviennent ? (O/N) : ');
  if (corriger.toLowerCase() === 'n') {
    const newDesc = await ask('Précise ce qui doit changer : ');
    try { detailsData = await genererDetails(lignes, newDesc); } catch(e) {}
  }
  // Question acquitté
  const acquitte_rep = await ask('\nFacture acquittée ? (O/N) : ');
  let dateAcquitte = '';
  if (acquitte_rep.toLowerCase() === 'o') {
    dateAcquitte = new Date().toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'numeric'});
  }
  rl.close();

  // Détails fixes
  const DETAILS_FIXES = {
    'deplacement': ['Deplacement technicien SINELEC sur site client','Vehicule equipe outillage professionnel complet','Forfait inclus pour intervention superieure a 200 EUR'],
    'urgence jour': ['Intervention prioritaire journee sous 2h','Technicien qualifie disponible 24h/24 7j/7','Diagnostic et remise en service immediate'],
    'urgence soir': ['Intervention prioritaire soiree 18h-22h','Technicien qualifie disponible 7j/7','Majoration horaire soiree incluse forfait'],
    'urgence nuit': ['Intervention prioritaire nuit week-end feries','Technicien qualifie disponible 24h/24','Majoration horaire nuit incluse forfait'],
    'tableau complet 1': ['Fourniture coffret Legrand/Hager 1 rangee 13 modules','Depose evacuation ancien tableau existant','Pose disj. differentiel 30mA type A + disj. divisionnaires','Peigne raccordement + barre terre + DLCU','Raccordement reperage tous circuits existants','Test differentiel + continuite terre + mise en service','Conformite NF C 15-100 - Garantie decennale ORUS'],
    'tableau complet 2': ['Fourniture coffret Legrand/Hager 2 rangees 26 modules','Depose evacuation ancien tableau existant','Pose 2 disj. differentiels 30mA type A + disj. divisionnaires','Peigne raccordement + barre terre + DLCU','Raccordement reperage tous circuits existants','Test differentiel + continuite terre + mise en service','Conformite NF C 15-100 - Garantie decennale ORUS'],
    'tableau complet 3': ['Fourniture coffret Legrand/Hager 3 rangees 39 modules','Depose evacuation ancien tableau existant','Pose 3 disj. differentiels 30mA type A + disj. divisionnaires','Peigne raccordement + barre terre + DLCU','Raccordement reperage tous circuits existants','Test differentiel + continuite terre + mise en service','Conformite NF C 15-100 - Garantie decennale ORUS'],
    'mini tableau': ['Fourniture mini coffret Legrand/Hager NF C 15-100','Pose disj. differentiel 30mA + disj. divisionnaires','Raccordement + test + mise en service - Garantie ORUS'],
  };

  const lignesAvecDetails = lignes.map((l, i) => {
    const nomLower = l.designation.toLowerCase();
    let detailsFixe = null;
    for (const [key, vals] of Object.entries(DETAILS_FIXES)) {
      if (nomLower.includes(key.toLowerCase())) { detailsFixe = vals; break; }
    }
    const detail = detailsData && detailsData.lignes_detail && detailsData.lignes_detail[i];
    return { designation: l.designation, details: detailsFixe || (detail ? detail.details : []), qte: l.qte, prixUnit: l.prixUnit, total: l.total };
  });

  const detailsFile = '_details_facture.json';
  fs.writeFileSync(detailsFile, JSON.stringify({
    lignes: lignesAvecDetails,
    acquitte: dateAcquitte
  }), 'utf8');

  const pdfName = `FACTURE_${numFacture.replace(/[^a-zA-Z0-9]/g,'_')}_${client_nom.replace(/\s+/g,'_').toUpperCase()}.pdf`;
  const logoPath = path.join(__dirname, 'logo_sinelec.jpeg').replace(/\\/g, '/');
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  const mentionTVA = typeFacture === 'soustrait' 
    ? 'TVA en auto-liquidation - art. 283-2 nonies CGI - Le preneur est redevable de la TVA'
    : 'TVA non applicable - art. 293B CGI';

  const py = `# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable, PageBreak)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.pdfgen import canvas as pdfcanvas
import os, json

JAUNE=colors.HexColor('#F5A623'); JAUNE_DARK=colors.HexColor('#D4891A')
JAUNE_PALE=colors.HexColor('#FFFBF2'); NOIR=colors.HexColor('#111111')
GRIS_DARK=colors.HexColor('#444444'); GRIS_MED=colors.HexColor('#888888')
GRIS_LIGHT=colors.HexColor('#F5F5F5'); GRIS_LINE=colors.HexColor('#E5E5E5')
GRIS_BG=colors.HexColor('#FAFAFA'); BLANC=colors.white
W,H=A4; LOGO='${logoPath}'

def p(txt,size=9,font='Helvetica',color=NOIR,align=TA_LEFT,sb=0,sa=0,leading=None):
    kw=dict(fontSize=size,fontName=font,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa)
    if leading: kw['leading']=leading
    return Paragraph(str(txt),ParagraphStyle('x',**kw))

class SC(pdfcanvas.Canvas):
    def __init__(self,filename,data,**kw):
        super().__init__(filename,**kw); self._saved=[]; self._data=data
    def showPage(self):
        self._saved.append(dict(self.__dict__)); self._startPage()
    def save(self):
        n=len(self._saved)
        for i,state in enumerate(self._saved):
            self.__dict__.update(state); self._draw(i+1,n); super().showPage()
        super().save()
    def _draw(self,pn,total):
        self.saveState(); d=self._data
        self.setFillColor(JAUNE); self.rect(0,0,0.5*cm,H,fill=1,stroke=0)
        if pn==1:
            if os.path.exists(LOGO):
                self.drawImage(LOGO,1.2*cm,H-2.8*cm,width=3.2*cm,height=2.2*cm,preserveAspectRatio=True,mask='auto')
            self.setFont('Helvetica',7); self.setFillColor(GRIS_MED)
            for i,line in enumerate(['128 Rue La Boetie, 75008 Paris','Tel : 07 87 38 86 22','sinelec.paris@gmail.com','SIRET : 91015824500019']):
                self.drawString(1.2*cm,H-(3.0+i*0.33)*cm,line)
            self.setFont('Helvetica-Bold',36); self.setFillColor(NOIR)
            self.drawRightString(W-1.0*cm,H-1.6*cm,'FACTURE')
            self.setFillColor(JAUNE); self.rect(W-7.5*cm,H-1.95*cm,6.5*cm,0.15*cm,fill=1,stroke=0)
            self.setFont('Helvetica-Bold',8); self.setFillColor(NOIR)
            self.drawRightString(W-1.0*cm,H-2.3*cm,'N deg ${esc(numFacture)}')
            self.setFont('Helvetica',7.5); self.setFillColor(GRIS_MED)
            self.drawRightString(W-1.0*cm,H-2.65*cm,'Date : ${dateStr}')
            self.drawRightString(W-1.0*cm,H-2.95*cm,'Echeance : A reception de la facture')
            self.setStrokeColor(GRIS_LINE); self.setLineWidth(0.5)
            self.line(1.2*cm,H-3.3*cm,W-1.0*cm,H-3.3*cm)
        # TAMPON ACQUITTÉ diagonal professionnel
        if pn==1 and d.get('raw',{}).get('acquitte',''):
            self.saveState()
            self.translate(W/2, H/2-2*cm)
            self.rotate(35)
            self.setFillColor(colors.HexColor('#CC0000'))
            # Texte ACQUITTÉ grand
            self.setFont('Helvetica-Bold', 72)
            self.setFillAlpha(0.18)
            self.drawCentredString(0, 0.4*cm, 'ACQUITTE')
            # Date en dessous
            self.setFont('Helvetica-Bold', 18)
            self.setFillAlpha(0.35)
            self.drawCentredString(0, -0.9*cm, 'Paye le ' + d.get('raw',{}).get('acquitte',''))
            self.restoreState()
        self.setFillColor(NOIR); self.rect(0.5*cm,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(JAUNE); self.rect(0.5*cm,1.0*cm,W,0.07*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#777777'))
        self.drawCentredString(W/2+0.25*cm,0.38*cm,'SINELEC EI  -  128 Rue La Boetie 75008 Paris  -  SIRET : 91015824500019  -  ${mentionTVA}  -  Garantie decennale ORUS')
        self.setFont('Helvetica',7); self.setFillColor(JAUNE)
        self.drawRightString(W-1.0*cm,0.15*cm,'${esc(numFacture)}  |  Page '+str(pn)+' / '+str(total))
        self.restoreState()

data={'num':'${esc(numFacture)}','date':'${dateStr}','client':'${esc(client_nom)}','adresse':'${esc(adresse)}','acquitte':'" + dateAcquitte + "','date_acquitte':'" + dateAcquitte + "',
      'raw': json.loads(open('${detailsFile}',encoding='utf-8').read()),
      'totalHT':${totalHT.toFixed(2)},'type':'${typeFacture}'}
lignes=data['raw']['lignes']
acquitte=data['raw'].get('acquitte','')

doc=SimpleDocTemplate('${esc(pdfName)}',pagesize=A4,
    leftMargin=1.0*cm,rightMargin=1.0*cm,topMargin=3.8*cm,bottomMargin=1.0*cm)
story=[]; totalHT=data['totalHT']

# BLOC DE / POUR
de_b=Table([[p('DE',7,'Helvetica-Bold',JAUNE,sa=2)],[p('SINELEC PARIS',10,'Helvetica-Bold')],[p('128 Rue La Boetie, 75008 Paris',8.5,color=GRIS_DARK)],[p('07 87 38 86 22  |  sinelec.paris@gmail.com',8.5,color=GRIS_DARK)]],colWidths=[8.5*cm])
de_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,JAUNE),('TOPPADDING',(0,0),(0,0),8)]))
pour_b=Table([[p('FACTURER A',7,'Helvetica-Bold',JAUNE,sa=2)],[p(data['client'],10,'Helvetica-Bold')],[p(data['adresse'],8.5,color=GRIS_DARK)]],colWidths=[8.5*cm])
pour_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),12),('BACKGROUND',(0,0),(-1,-1),JAUNE_PALE),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#EDD898')),('LINEBEFORE',(0,0),(0,-1),3,JAUNE),('TOPPADDING',(0,0),(0,0),8)]))
story.append(Table([[de_b,pour_b]],colWidths=[9.1*cm,9.1*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.15*cm))

# BADGE ACOMPTE si nécessaire
if data['type'] == 'acompte':
    badge=Table([[p('FACTURE ACOMPTE - 40% DU MONTANT TOTAL',8,'Helvetica-Bold',BLANC,TA_CENTER)]],colWidths=[18.2*cm])
    badge.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),JAUNE_DARK),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story.append(badge)
    story.append(Spacer(1,0.1*cm))
elif data['type'] == 'soustrait':
    badge=Table([[p('SOUS-TRAITANCE - TVA EN AUTO-LIQUIDATION ART. 283-2 NONIES CGI',8,'Helvetica-Bold',BLANC,TA_CENTER)]],colWidths=[18.2*cm])
    badge.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#CC0000')),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
    story.append(badge)
    story.append(Spacer(1,0.1*cm))

# TABLEAU PRESTATIONS
cw=[0.8*cm,9.5*cm,1.6*cm,1.0*cm,2.3*cm,3.0*cm]
rows=[[p('#',7,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7,'Helvetica-Bold',BLANC),p('QTE',7,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(lignes):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=GRIS_MED,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9),p(str(q),9,align=TA_CENTER),p('u',9,align=TA_CENTER,color=GRIS_MED),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('%.2f \u20ac'%l['total'],9,'Helvetica-Bold',NOIR,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7,color=GRIS_DARK),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),NOIR),('LINEBELOW',(0,0),(-1,0),3,JAUNE),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('BOX',(0,0),(-1,-1),0.3,GRIS_LINE)]
row_idx=1; bg=True
for l in lignes:
    nb=1+len(l.get('details',[]))
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),BLANC if bg else GRIS_BG))
    ts.append(('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LINE))
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts))
story.append(t); story.append(Spacer(1,0.1*cm))

# TOTAUX
tt=Table([['',p('Total HT',9,color=GRIS_DARK,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,align=TA_RIGHT)],['',p('TVA',9,color=GRIS_DARK,align=TA_RIGHT),p('Voir pied de page',7,color=GRIS_MED,align=TA_RIGHT)]],colWidths=[9.1*cm,4.5*cm,4.6*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LINE),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('GRID',(0,0),(-1,-1),0,BLANC)]))
story.append(tt); story.append(Spacer(1,0.08*cm))

net=Table([[p('NET A PAYER',11,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,13,'Helvetica-Bold',JAUNE,TA_RIGHT)]],colWidths=[9.1*cm,9.1*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),NOIR),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3.5,JAUNE),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.15*cm))

# PAIEMENT
story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LINE,spaceAfter=6))
story.append(p('MODALITES DE PAIEMENT',8,'Helvetica-Bold',sa=4))
pay=Table([[p('Mode',8,'Helvetica-Bold',GRIS_MED),p('Echeance',8,'Helvetica-Bold',GRIS_MED),p('Montant',8,'Helvetica-Bold',GRIS_MED,align=TA_RIGHT)],[p('Virement / Especes / Carte bancaire',9),p('A reception de la facture',9,color=GRIS_DARK),p('%.2f \u20ac'%totalHT,9,'Helvetica-Bold',JAUNE_DARK,TA_RIGHT)]],colWidths=[5.5*cm,7.5*cm,5.2*cm])
pay.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,0),0.5,GRIS_LINE),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('BACKGROUND',(0,1),(-1,1),JAUNE_PALE)]))
story.append(pay); story.append(Spacer(1,0.1*cm))

iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_MED),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',NOIR),p('BIC',7,'Helvetica-Bold',GRIS_MED,align=TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',NOIR,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_LIGHT),('BOX',(0,0),(-1,-1),0.3,GRIS_LINE),('LINEBEFORE',(0,0),(0,-1),3,JAUNE),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban)

# PAGE 2 : CONDITIONS GENERALES
story.append(PageBreak())
story.append(p('CONDITIONS GENERALES DE TRAVAUX',13,'Helvetica-Bold',NOIR,TA_CENTER,sa=10))
story.append(HRFlowable(width='100%',thickness=2,color=JAUNE,spaceAfter=12))

def sec(title,items):
    out=[p(title,8.5,'Helvetica-Bold',JAUNE_DARK,sa=3)]
    for sub,txt in items:
        if sub: out.append(p(sub,8.5,'Helvetica-Bold',NOIR,sb=3,sa=1))
        out.append(p(txt,8,color=GRIS_DARK,sa=3,leading=12))
    return out

cg_l,cg_r=[],[]
cg_l+=sec('PAIEMENT ET FACTURATION',[('Echeance',"Facture payable a reception. Tout retard entraine des interets de 3x le taux legal + indemnite 40 EUR."),('Acompte',"40% a la signature pour toute intervention superieure a 400 EUR HT."),('Modes',"Virement bancaire, especes, carte bancaire.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('PRESTATIONS',[('Inclus',"Prix tout compris : fourniture materiel pro, main d oeuvre, deplacement, test et mise en service."),('Supplement',"Toute modification ou decouverte en cours de travaux entraine un avenant.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('DELAIS ET RECEPTION',[('Demarrage',"Delais indicatifs. Reception dans les 7 jours suivant achevement."),('Reserves',"Reserves a noter sur PV. Aucune reclamation ulterieure sans PV signe.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('DONNEES PERSONNELLES',[('RGPD',"Donnees traitees uniquement pour execution de la facture. Contact : sinelec.paris@gmail.com")])

cg_r+=sec('GARANTIES',[('Decennale',"Garantie decennale ORUS couvrant tous les travaux realises. Conformite NF C 15-100."),('Legale',"Garanties legales applicables des reception des travaux."),('Exclusions',"Exclue si usure normale, negligence ou modification par tiers non agrees.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('RESPONSABILITE',[('Avant reception',"Tout dommage cause par le client ou tiers degage la responsabilite de SINELEC."),('Assurance',"SINELEC Paris est assure en RC Pro et garantie decennale ORUS.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('RESILIATION',[('Avant travaux',"Acomptes conserves en cas de resiliation. Frais engages factures sur justificatif."),('Litige',"Resolution amiable prioritaire. Mediateur : cm2c@cm2c.net. Tribunal judiciaire de Paris.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('RETRACTATION',[('Particuliers',"Droit de retractation 14 jours a compter de la signature (clients particuliers uniquement).")])

def mkcol(items,w):
    t=Table([[i] for i in items],colWidths=[w])
    t.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0)]))
    return t

cgt=Table([[mkcol(cg_l,8.7*cm),mkcol(cg_r,8.7*cm)]],colWidths=[9.2*cm,9.2*cm])
cgt.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('LINEAFTER',(0,0),(0,-1),0.3,GRIS_LINE),('RIGHTPADDING',(0,0),(0,-1),12),('LEFTPADDING',(1,0),(1,-1),12)]))
story.append(cgt)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,data=data,**kw))
print('OK '+data['num'])
`;

  const pyFile = '_facture_tmp.py';
  fs.writeFileSync(pyFile, py, 'utf8');
  console.log('\n⏳ Génération PDF...');
  try {
    execSync(`python ${pyFile}`, { stdio: 'inherit' });
  } catch(e) {
    try { execSync(`python3 ${pyFile}`, { stdio: 'inherit' }); }
    catch(e2) { console.error('❌ Python non trouvé.'); }
  }
  try { fs.unlinkSync(pyFile); } catch(e) {}
  try { fs.unlinkSync(detailsFile); } catch(e) {}

  console.log(`\n✅ Facture générée : ${pdfName}`);
  console.log(`   Total HT : ${totalHT.toFixed(2)} € — ${mentionTVA}\n`);
}

main().catch(console.error);
