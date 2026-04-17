require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

// ── NUMÉROTATION AUTOMATIQUE ──────────────────────────────────────────────
function getNextNumero() {
  const counterFile = path.join(__dirname, 'compteur.json');
  const today = new Date();
  const year = today.getFullYear().toString().slice(-2);
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const prefix = `OS-20${year}${month}`;
  
  let counter = { prefix: prefix, num: 0 };
  try {
    counter = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    // Reset si mois différent
    if (counter.prefix !== prefix) counter = { prefix: prefix, num: 0 };
  } catch(e) {}
  
  counter.num += 1;
  fs.writeFileSync(counterFile, JSON.stringify(counter), 'utf8');
  return `${prefix}-${String(counter.num).padStart(3, '0')}`;
}
const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

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
    'Prise standard': 90,
    'Prise spécialisée cuisinière 32A': 140,
    'Prise étanche extérieure IP44': 110,
    'Déplacement prise électrique': 130,
    'Prise RJ45 réseau/téléphone': 65,
    'Prise USB intégrée': 85,
    'Interrupteur simple': 90,
    'Interrupteur va-et-vient': 110,
    'Variateur / interrupteur connecté': 130,
  },
  '3. Éclairage & Luminaires': {
    'Luminaire simple (plafonnier, applique)': 115,
    'Lustre / luminaire lourd': 200,
    'Spot encastré (unité)': 75,
    'Bandeau LED (par ml)': 60,
    'Point lumineux DCL': 100,
    'Éclairage extérieur': 150,
    'Chemin lumineux 3 spots minimum': 250,
  },
  '4. Tableau Électrique & Protections': {
    'Disjoncteur standard': 150,
    'Disjoncteur différentiel 30mA type AC': 150,
    'Interrupteur différentiel 63A type A': 250,
    'Contacteur jour/nuit': 120,
    'Parafoudre': 160,
    'Télérupteur': 110,
    'Mini tableau normes NF C 15-100': 185,
    'Remplacement tableau complet 1 rangée': 1050,
    'Remplacement tableau complet 2 rangées': 1850,
    'Remplacement tableau complet 3 rangées': 2500,
    'Ajout module tableau existant': 90,
  },
  '5. Dépannage & Recherche de Panne': {
    'Recherche de panne électrique': 120,
    'Réparation court-circuit': 125,
    'Réactivation coupure / disjonction générale': 90,
    'Réparation prise défectueuse': 90,
    'Réparation interrupteur défectueux': 90,
    'Réparation chauffage électrique': 220,
    'Réparation volet roulant électrique': 180,
    'Diagnostic complet installation': 150,
    'Recherche fuite de courant': 130,
  },
  '6. Mise aux Normes & Sécurité': {
    'Mise à la terre complète': 650,
    'Liaison équipotentielle principale': 160,
    'Liaison équipotentielle salle de bain': 140,
    'Détecteur de fumée DAAF': 85,
    'Détecteur monoxyde de carbone': 95,
    'Diagnostic électrique obligatoire': 150,
  },
  '7. Circuits & Câblage': {
    'Création circuit apparent 5m': 200,
    'Création circuit encastré 5m': 300,
    'Tirage câble supplémentaire (par ml)': 20,
    'Pose goulotte/moulure (par ml)': 15,
    'Pose chemin de câble (par ml)': 30,
    'Passage câble dans cloison/dalle': 120,
  },
  '8. Chauffage Électrique': {
    'Pose radiateur convecteur': 200,
    'Pose radiateur à inertie': 350,
    'Pose sèche-serviettes électrique': 280,
    'Pose thermostat programmable': 140,
    'Pose thermostat connecté / fil pilote': 180,
    'Remplacement convecteur vers inertie': 450,
    'Dépose ancien radiateur': 60,
  },
  '9. Ventilation (VMC)': {
    'Pose VMC simple flux autoréglable': 450,
    'Pose VMC simple flux hygroréglable': 700,
    'Remplacement moteur VMC': 250,
    'Remplacement bouche extraction': 60,
    'Nettoyage / entretien VMC': 100,
    'Création ligne dédiée VMC': 110,
  },
  '10. Équipements Divers': {
    'Pose interphone audio': 500,
    'Pose visiophone': 900,
    'Pose sonnette / carillon filaire': 130,
    'Pose motorisation volet roulant': 350,
    'Raccordement chauffe-eau électrique': 250,
    'Pose antenne TV / prise coaxiale': 200,
    'Pose détecteur de mouvement': 90,
    'Pose prise borne recharge Green Up': 300,
    'Installation borne IRVE 7kW': 1500,
  },
};

async function genererDevis(description, lignes, client_nom, adresse) {
  const lignesStr = lignes.map(l => 
    `- ${l.designation} (qté: ${l.qte}) : ${l.total.toFixed(2)} €`
  ).join('\n');
  const total = lignes.reduce((s, l) => s + l.total, 0);

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Tu es SINELEC PARIS, électricien professionnel Paris et Île-de-France, 24h/24, spécialisé dépannage et mise aux normes NF C 15-100.

Client : ${client_nom}
Adresse : ${adresse}
Description du chantier : ${description}
Prestations facturées :
${lignesStr}
Total HT : ${total.toFixed(2)} €

MISSION : Génère une désignation professionnelle DÉTAILLÉE pour ce devis.

RÈGLES IMPORTANTES :
1. Pour CHAQUE prestation, détaille ce qui est INCLUS dans le prix (fourniture matériel, dépose ancien, pose, raccordement, test, mise en service)
2. Justifie le prix en expliquant le travail réalisé — si le client demande "pourquoi c'est ce prix", la réponse doit être dans le devis
3. Mentionne les normes respectées (NF C 15-100, DTU)
4. Mentionne la garantie décennale ORUS
5. Ton professionnel et rassurant
6. Maximum 15 lignes au total

Format : texte continu professionnel, pas de bullet points, pas de tirets.`
    }]
  });

  const text = msg.content[0].text;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch(e) {
    return null;
  }
}

async function main() {
  console.log('\n══════════════════════════════════════════');
  console.log('      SINELEC PARIS — GÉNÉRATEUR DEVIS');
  console.log('══════════════════════════════════════════\n');

  const numDevis    = getNextNumero();
  console.log(`\n📋 N° Devis : ${numDevis}\n`);
  const client_nom  = await ask('Nom du client         : ');
  const adresse     = await ask('Adresse du client     : ');
  const description = await ask('Décris le chantier en quelques mots : ');

  const today = new Date();
  const fmt = (d) => d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const dateStr = fmt(today);
  const dateValide = new Date(today); dateValide.setDate(dateValide.getDate() + 30);
  const dateValideStr = fmt(dateValide);

  const lignes = [];

  while (true) {
    console.log('\n─── CATÉGORIES ───────────────────────────');
    const cats = Object.keys(GRILLE);
    cats.forEach((cat, i) => console.log(`  ${i+1}. ${cat}`));
    console.log('  0. Prestation personnalisée');
    console.log('  Entrée = terminer\n');

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
    console.log(`  ✅ Ajouté : ${nom} × ${qte} = ${(qte * prix).toFixed(2)} €`);
  }

  if (lignes.length === 0) { rl.close(); console.log('\n❌ Aucune prestation. Abandon.'); return; }

  const totalHT = lignes.reduce((s, l) => s + l.total, 0);

  console.log('\n⏳ Claude génère les détails techniques...');
  let detailsData = null;
  try {
    const rawResult = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Tu es SINELEC PARIS, electricien professionnel Paris IDF.
Prestations : ${lignes.map((l,i) => `${i+1}. ${l.designation}`).join(' | ')}
Chantier : ${description}

Pour chaque prestation, genere 3 sous-lignes COURTES style Obat BTP.
Maximum 8 mots par detail. Pas de phrase longue. Style telegraphique professionnel.

Exemples de bons details courts :
- "Fourniture tableau Legrand XL3 2 rangees 26 modules"
- "Depose et evacuation ancien tableau existant"
- "Pose disj. differentiel 30mA type A + peignes"
- "Raccordement circuits + test differentiel NF C 15-100"
- "Fourniture cable terre vert/jaune 2.5mm2"
- "Raccordement borne de terre existante"
- "Test isolation et mise en service garantie ORUS"

Pour TABLEAU electrique ajoute obligatoirement :
- disjoncteur differentiel 30mA type A
- disjoncteurs divisionnaires par circuit (eclairage/prises/cuisine)
- peigne raccordement + barre terre + DLCU

Reponds UNIQUEMENT JSON valide :
{"lignes_detail":[{"designation":"NOM EXACT","details":["detail court 1","detail court 2","detail court 3"]}]}`
      }]
    });
    
    const rawText = rawResult.content[0].text;
    console.log('\n📋 Réponse Claude API reçue');
    
    // Parser le JSON
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      detailsData = JSON.parse(jsonMatch[0]);
      if (detailsData && detailsData.lignes_detail) {
        console.log('\n✅ Détails générés :');
        console.log('─'.repeat(60));
        detailsData.lignes_detail.forEach((l, i) => {
          console.log(`\n  ${i+1}. ${l.designation}`);
          l.details.forEach(d => console.log(`     • ${d}`));
        });
        console.log('─'.repeat(60));
      }
    } else {
      console.log('⚠ JSON non trouvé dans la réponse');
      console.log(rawText.substring(0, 200));
    }
  } catch(e) {
    console.log('⚠ Claude API erreur:', e.message);
  }

  const corriger = await ask('\nLes détails te conviennent ? (O/N) : ');
  
  rl.close();

  const pdfName = `DEVIS_${numDevis.replace(/[^a-zA-Z0-9]/g,'_')}_${client_nom.replace(/\s+/g,'_').toUpperCase()}.pdf`;
  const logoPath = path.join(__dirname, 'logo_sinelec.jpeg').replace(/\\/g, '/');
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"');
  const escPy = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  const lignesStr = lignes.map(l =>
    `{"designation": "${escPy(l.designation)}", "qte": ${l.qte}, "prixUnit": ${l.prixUnit}, "total": ${l.total}}`
  ).join(', ');

  // Écrire les détails dans un fichier JSON temporaire
  const detailsFile = '_details_tmp.json';
  // Construire les lignes enrichies avec détails
  // Détails fixes par type de prestation
  const DETAILS_FIXES = {
    'deplacement': [
      'Transport technicien SINELEC sur site client',
      'Materiel et outillage professionnel inclus',
      'Offert pour toute intervention superieure a 200 EUR'
    ],
    'urgence jour': [
      'Intervention prioritaire en journee sous 2h',
      'Technicien qualifie disponible 24h/24 7j/7',
      'Diagnostic et remise en service immediate'
    ],
    'urgence soir': [
      'Intervention prioritaire soiree 18h-22h',
      'Technicien qualifie disponible 7j/7',
      'Majoration horaire soiree incluse dans le forfait'
    ],
    'urgence nuit': [
      'Intervention prioritaire nuit week-end et jours feries',
      'Technicien qualifie disponible 24h/24',
      'Majoration horaire nuit incluse dans le forfait'
    ],
    'tableau complet 1': [
      'Fourniture coffret Legrand ou Hager 1 rangee 13 modules',
      'Depose evacuation ancien tableau existant',
      'Pose disjoncteur differentiel 30mA type A 40A',
      'Pose disjoncteurs divisionnaires par circuit (eclairage/prises/cuisine)',
      'Peigne raccordement phase + neutre + barre de terre equipotentielle',
      'DLCU dispositif de coupure urgence reglementaire',
      'Raccordement reperage tous circuits existants',
      'Test differentiel + controle continuite terre + mise en service',
      'Conformite NF C 15-100 - Garantie decennale ORUS incluse'
    ],
    'tableau complet 2': [
      'Fourniture coffret Legrand ou Hager 2 rangees 26 modules',
      'Depose evacuation ancien tableau existant',
      'Pose 2 disjoncteurs differentiels 30mA type A 40A',
      'Pose disjoncteurs divisionnaires par circuit (eclairage/prises/cuisine/SDB/chauffe-eau)',
      'Peigne raccordement phase + neutre + barre de terre equipotentielle',
      'DLCU dispositif de coupure urgence reglementaire',
      'Raccordement reperage tous circuits existants',
      'Test differentiel + controle continuite terre + mise en service',
      'Conformite NF C 15-100 - Garantie decennale ORUS incluse'
    ],
    'tableau complet 3': [
      'Fourniture coffret Legrand ou Hager 3 rangees 39 modules',
      'Depose evacuation ancien tableau existant',
      'Pose 3 disjoncteurs differentiels 30mA type A 40A',
      'Pose disjoncteurs divisionnaires par circuit (eclairage/prises/cuisine/SDB/chauffe-eau/VMC)',
      'Peigne raccordement phase + neutre + barre de terre equipotentielle',
      'DLCU dispositif de coupure urgence reglementaire',
      'Raccordement reperage tous circuits existants',
      'Test differentiel + controle continuite terre + mise en service',
      'Conformite NF C 15-100 - Garantie decennale ORUS incluse'
    ],
    'mini tableau': [
      'Fourniture mini coffret Legrand ou Hager normes NF C 15-100',
      'Pose disjoncteur differentiel 30mA + disjoncteurs divisionnaires',
      'Raccordement circuits + test + mise en service - Garantie ORUS'
    ],
  };

  const lignesAvecDetails = lignes.map((l, i) => {
    // Chercher si prestation a des détails fixes
    const nomLower = l.designation.toLowerCase();
    let detailsFixe = null;
    for (const [key, vals] of Object.entries(DETAILS_FIXES)) {
      if (nomLower.includes(key.toLowerCase())) { detailsFixe = vals; break; }
    }
    
    const detail = detailsData && detailsData.lignes_detail && detailsData.lignes_detail[i];
    return {
      designation: l.designation,
      details: detailsFixe || (detail ? detail.details : []),
      qte: l.qte,
      prixUnit: l.prixUnit,
      total: l.total
    };
  });
  fs.writeFileSync(detailsFile, JSON.stringify(lignesAvecDetails), 'utf8');

  const py = `# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                 Paragraph, Spacer, HRFlowable, PageBreak)
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
            self.drawRightString(W-1.0*cm,H-1.6*cm,'DEVIS')
            self.setFillColor(JAUNE); self.rect(W-7.5*cm,H-1.95*cm,6.5*cm,0.15*cm,fill=1,stroke=0)
            self.setFont('Helvetica-Bold',8); self.setFillColor(NOIR)
            self.drawRightString(W-1.0*cm,H-2.3*cm,'N deg ${escPy(numDevis)}')
            self.setFont('Helvetica',7.5); self.setFillColor(GRIS_MED)
            self.drawRightString(W-1.0*cm,H-2.65*cm,'Date : ${dateStr}')
            self.drawRightString(W-1.0*cm,H-2.95*cm,'Valable jusqu au : ${dateValideStr}')
            self.setStrokeColor(GRIS_LINE); self.setLineWidth(0.5)
            self.line(1.2*cm,H-3.3*cm,W-1.0*cm,H-3.3*cm)
        self.setFillColor(NOIR); self.rect(0.5*cm,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(JAUNE); self.rect(0.5*cm,1.0*cm,W,0.07*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#777777'))
        self.drawCentredString(W/2+0.25*cm,0.38*cm,'SINELEC EI  -  128 Rue La Boetie 75008 Paris  -  SIRET : 91015824500019  -  TVA non applicable art. 293B CGI  -  Garantie decennale ORUS')
        self.setFont('Helvetica',7); self.setFillColor(JAUNE)
        self.drawRightString(W-1.2*cm,0.15*cm,'${escPy(numDevis)}  |  Page '+str(pn)+' / '+str(total))
        self.restoreState()

data={'num':'${escPy(numDevis)}','date':'${dateStr}','valide':'${dateValideStr}',
      'client':'${escPy(client_nom)}','adresse':'${escPy(adresse)}',
      'lignes': json.loads(open('_details_tmp.json', encoding='utf-8').read()),
      'totalHT':${totalHT.toFixed(2)}}

doc=SimpleDocTemplate('${escPy(pdfName)}',pagesize=A4,
    leftMargin=1.0*cm,rightMargin=1.0*cm,topMargin=3.8*cm,bottomMargin=1.0*cm)
story=[]; totalHT=data['totalHT']; lignes=data['lignes']

de_b=Table([[p('DE',7,'Helvetica-Bold',JAUNE,sa=2)],[p('SINELEC PARIS',10,'Helvetica-Bold')],[p('128 Rue La Boetie, 75008 Paris',8.5,color=GRIS_DARK)],[p('07 87 38 86 22  |  sinelec.paris@gmail.com',8.5,color=GRIS_DARK)]],colWidths=[8.5*cm])
de_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,JAUNE),('TOPPADDING',(0,0),(0,0),8)]))
pour_b=Table([[p('CLIENT',7,'Helvetica-Bold',JAUNE,sa=2)],[p(data['client'],10,'Helvetica-Bold')],[p(data['adresse'],8.5,color=GRIS_DARK)]],colWidths=[8.5*cm])
pour_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),12),('BACKGROUND',(0,0),(-1,-1),JAUNE_PALE),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#EDD898')),('LINEBEFORE',(0,0),(0,-1),3,JAUNE),('TOPPADDING',(0,0),(0,0),8)]))
story.append(Table([[de_b,pour_b]],colWidths=[9.1*cm,9.1*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.5*cm))

cw=[0.8*cm,9.5*cm,1.6*cm,1.0*cm,2.3*cm,3.0*cm]
rows=[[p('#',7,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7,'Helvetica-Bold',BLANC),p('QTE',7,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(lignes):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    # Ligne principale
    rows.append([p(str(i+1),9,color=GRIS_MED,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9),p(str(q),9,align=TA_CENTER),p('u',9,align=TA_CENTER,color=GRIS_MED),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('%.2f \u20ac'%l['total'],9,'Helvetica-Bold',NOIR,TA_RIGHT)])
    # Sous-détails
    for det in l.get('details', []):
        rows.append(['',p('   • '+det,7,color=GRIS_DARK),'','','',''])
n=len(rows)-1
t=Table(rows,colWidths=cw)
# Construire le style dynamiquement
ts=[
    ('BACKGROUND',(0,0),(-1,0),NOIR),
    ('LINEBELOW',(0,0),(-1,0),3,JAUNE),
    ('VALIGN',(0,0),(-1,-1),'TOP'),
    ('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),
    ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
    ('BOX',(0,0),(-1,-1),0.3,GRIS_LINE),
]
# Alterner fond par prestation principale
row_idx = 1
bg_toggle = True
for i,l in enumerate(lignes):
    nb_rows = 1 + len(l.get('details', []))
    bg = BLANC if bg_toggle else GRIS_BG
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb_rows-1),bg))
    ts.append(('LINEBELOW',(0,row_idx+nb_rows-1),(-1,row_idx+nb_rows-1),0.3,GRIS_LINE))
    row_idx += nb_rows
    bg_toggle = not bg_toggle
t.setStyle(TableStyle(ts))
story.append(t); story.append(Spacer(1,0.1*cm))

tt=Table([['',p('Total HT',9,color=GRIS_DARK,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,align=TA_RIGHT)],['',p('TVA',9,color=GRIS_DARK,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_MED,align=TA_RIGHT)]],colWidths=[9.1*cm,4.5*cm,4.6*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LINE),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('GRID',(0,0),(-1,-1),0,BLANC)]))
story.append(tt); story.append(Spacer(1,0.08*cm))

net=Table([[p('NET A PAYER',11,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,13,'Helvetica-Bold',JAUNE,TA_RIGHT)]],colWidths=[9.1*cm,9.1*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),NOIR),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3.5,JAUNE),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.15*cm))

story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LINE,spaceAfter=8))
story.append(p('CONDITIONS',8,'Helvetica-Bold',NOIR,sa=6))
cond=Table([[p('Acompte de 40% a la signature',9,color=GRIS_DARK),p('%.2f \u20ac'%(totalHT*0.4),9,'Helvetica-Bold',JAUNE_DARK,TA_RIGHT)],[p('Reste a facturer a la fin des travaux',9,color=GRIS_DARK),p('%.2f \u20ac'%(totalHT*0.6),9,align=TA_RIGHT)],[p('Devis valable 30 jours — Paiement : virement, especes, carte bancaire',8,color=GRIS_MED),'']],colWidths=[14*cm,4.2*cm])
cond.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,1),0.3,GRIS_LINE),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('SPAN',(0,2),(1,2))]))
story.append(cond); story.append(Spacer(1,0.1*cm))

iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_MED),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',NOIR),p('BIC',7,'Helvetica-Bold',GRIS_MED,align=TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',NOIR,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),GRIS_LIGHT),('BOX',(0,0),(-1,-1),0.3,GRIS_LINE),('LINEBEFORE',(0,0),(0,-1),3,JAUNE),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban); story.append(Spacer(1,0.15*cm))

sig=Table([[
    Table([[p('Bon pour accord - Signature client :',9,color=GRIS_DARK)],[p(' ',18)],[p('Date : _______________',8.5,color=GRIS_DARK)]],colWidths=[8.5*cm],style=TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),12),('BOX',(0,0),(-1,-1),0.5,GRIS_LINE),('LINEBEFORE',(0,0),(0,-1),3,JAUNE),('TOPPADDING',(0,0),(0,0),10)])),
    Table([[p('Signature SINELEC Paris',9,'Helvetica-Bold',sa=4)],[p(' ',18)],[p('SINELEC PARIS',9,'Helvetica-Bold')]],colWidths=[8.5*cm],style=TableStyle([('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),12),('BOX',(0,0),(-1,-1),0.5,GRIS_LINE),('LINEBEFORE',(0,0),(0,-1),3,NOIR),('TOPPADDING',(0,0),(0,0),10)])),
]],colWidths=[9.1*cm,9.1*cm])
sig.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(sig)

story.append(PageBreak())
story.append(p('CONDITIONS GENERALES DE TRAVAUX',13,'Helvetica-Bold',NOIR,TA_CENTER,sa=10))
story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LINE,spaceAfter=12))

def sec(title,items):
    out=[p(title,8.5,'Helvetica-Bold',JAUNE_DARK,sa=3)]
    for sub,txt in items:
        if sub: out.append(p(sub,8.5,'Helvetica-Bold',NOIR,sb=3,sa=1))
        out.append(p(txt,8,color=GRIS_DARK,sa=3,leading=12))
    return out

cg_l,cg_r=[],[]
cg_l+=sec('COMMENT CA MARCHE ?',[('Valeur',"Conditions contractuelles. Toute commande implique l'acceptation sans reserve."),('Duree',"Le devis est valable 30 jours."),("Prise d'effet","Contrat forme a la signature + versement de l'acompte.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('PRESTATIONS',[('Devis',"Toutes les prestations sont listees. Sous-traitance possible."),('Mise a disposition',"Le client fournit eau, electricite et aires de stockage.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('DELAI',[('Demarrage',"Les delais sont indicatifs."),('Retard',"Penalites plafonnees a 5% du montant HT.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('RECEPTION',[('Achevement',"Reception dans les 7 jours suivant l'achevement."),('Reserves',"Reserves a noter sur le PV. Aucune reclamation ulterieure sinon.")])
cg_l.append(Spacer(1,0.2*cm))
cg_l+=sec('DONNEES PERSONNELLES',[('Acces',"Donnees traitees pour l'execution. Contact : sinelec.paris@gmail.com")])
cg_r+=sec('PRIX',[('Contenu',"Prix tout compris : fourniture materiel, main d oeuvre, deplacement, test et mise en service."),('Supplement',"Toute modification entraine un supplement."),('Paiement',"40% signature, solde fin travaux."),('Defaut',"Retard = exigibilite immediate + interets 3x taux legal + 40 EUR.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('GARANTIES',[('Travaux',"Garanties legales + garantie decennale ORUS. Travaux conformes NF C 15-100."),('Exclusions',"Exclue si usure normale ou negligence du client.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('RESILIATION',[(None,"Acomptes conserves en cas de resiliation avant demarrage.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('RETRACTATION',[('Principe',"14 jours de retractation pour les particuliers.")])
cg_r.append(Spacer(1,0.2*cm))
cg_r+=sec('EN CAS DE PROBLEME',[('Amiable',"Resolution amiable en priorite."),('Mediateur',"cm2c@cm2c.net"),('Tribunal',"Tribunal judiciaire de Paris. Droit francais.")])

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

  const pyFile = `_devis_tmp.py`;
  fs.writeFileSync(pyFile, py, 'utf8');
  console.log('\n⏳ Génération PDF...');
  try {
    execSync(`python ${pyFile}`, { stdio: 'inherit' });
  } catch(e) {
    try { execSync(`python3 ${pyFile}`, { stdio: 'inherit' }); }
    catch(e2) { console.error('❌ Python non trouvé.'); }
  }
  try { fs.unlinkSync(pyFile); } catch(e) {}
  try { fs.unlinkSync('_details_tmp.json'); } catch(e) {}

  console.log(`\n✅ PDF généré : ${pdfName}`);
  console.log(`   Total HT : ${totalHT.toFixed(2)} € — TVA non applicable art. 293B CGI\n`);
}

main().catch(console.error);
