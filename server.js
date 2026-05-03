// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET - VERSION PROPRE
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config-v2.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════

const APP_PASSWORD = process.env.APP_PASSWORD || 'sinelec2026';
const JWT_SECRET   = process.env.JWT_SECRET   || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

function genererToken() {
  const payload = JSON.stringify({ ts: Date.now(), exp: Date.now() + TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifierToken(token) {
  if (!token) return false;
  try {
    const [b64, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
    if (sig !== expectedSig) return false;
    const { exp } = JSON.parse(Buffer.from(b64, 'base64').toString());
    return Date.now() < exp;
  } catch(e) { return false; }
}

function authMiddleware(req, res, next) {
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/auth/check'];
  if (publicRoutes.some(r => req.path.startsWith(r))) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!verifierToken(token)) return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
  next();
}

app.use(authMiddleware);

app.post('/api/login', (req, res) => {
  const inputPwd = String(req.body.password || '').trim();
  const validPwd = String(APP_PASSWORD).trim();
  if (inputPwd !== validPwd) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ success: true, token: genererToken(), expiresIn: TOKEN_EXPIRY });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  res.json({ valid: verifierToken(token) });
});

// ═══════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() });
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;

// ═══════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════

app.get('/', (req, res) => res.send('OK SINELEC OS v2.0'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SINELEC OS v2.0' }));

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({ type, message, data, success, error_details: error ? String(error) : null });
  } catch(e) {}
}

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) { console.log('Email skippé:', to); return { skipped: true }; }
  const payload = {
    sender: { name: CONFIG.email.sender_name, email: CONFIG.email.sender_email },
    to: [{ email: to }], subject, htmlContent, trackOpens: 0, trackClicks: 0,
  };
  if (attachment) payload.attachment = [{ content: attachment.content, name: attachment.name }];
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const err = await res.text(); throw new Error('Brevo: ' + err); }
  return await res.json();
}

async function envoyerSMS(to, message) {
  if (!to || String(to).length < 8) return;
  let num = String(to).replace(/[\s\-\.]/g, '');
  if (num.startsWith('0')) num = '+33' + num.substring(1);
  if (!num.startsWith('+')) num = '+33' + num;
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'SINELEC', recipient: num, content: message, type: 'transactional' }),
    });
    if (!res.ok) console.error('SMS error:', await res.text());
    else console.log('SMS envoyé à', num);
  } catch(e) { console.error('SMS error:', e.message); }
}

async function incrementerCompteur(type) {
  const { data, error } = await supabase.from('compteurs').select('valeur').eq('type', type).single();
  if (error || !data) { await supabase.from('compteurs').insert({ type, valeur: 1 }); return 1; }
  const val = data.valeur + 1;
  await supabase.from('compteurs').update({ valeur: val }).eq('type', type);
  return val;
}

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase.from('grille_tarifaire').select('*').eq('actif', true).order('categorie, nom');
  if (error) return null;
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) grille[item.categorie] = [];
    grille[item.categorie].push({ code: item.code, nom: item.nom, prix: item.prix_ht });
  });
  return grille;
}

// ═══════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
  if (!CONFIG.features.devis_factures) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, description, prestations, partenaire, part_diahe, part_partenaire, nom_partenaire, intervention_type } = req.body;
    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis' ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}` : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;
    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    // Calcul parts partenaire
    const isPartenaire = !!partenaire;
    const pdiahe = isPartenaire ? (part_diahe || 60) : 100;
    const ppartenaire = isPartenaire ? (part_partenaire || 40) : 0;

    await supabase.from('historique').insert({
      num, type, client, email, telephone, adresse, prestations, total_ht,
      statut: 'envoye', date_envoi: new Date().toISOString(), source: 'app',
      partenaire: isPartenaire,
      part_diahe: pdiahe,
      part_partenaire: ppartenaire,
      nom_partenaire: isPartenaire ? (nom_partenaire || 'Alopronto') : null,
      intervention_type: intervention_type || 'immediat'
    });

    // ── UPSERT FICHE CLIENT AUTO ──────────────────
    if (client && (email || telephone)) {
      try {
        // Chercher si client existe déjà (par email ou téléphone)
        let existant = null;
        if (email) {
          const { data } = await supabase.from('clients').select('*').eq('email', email).single();
          existant = data;
        }
        if (!existant && telephone) {
          const { data } = await supabase.from('clients').select('*').eq('telephone', telephone).single();
          existant = data;
        }

        if (existant) {
          // Mettre à jour les infos
          await supabase.from('clients').update({
            nom: client,
            email: email || existant.email,
            telephone: telephone || existant.telephone,
            adresse: adresse || existant.adresse,
            derniere_intervention: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', existant.id);
        } else {
          // Créer nouvelle fiche client
          await supabase.from('clients').insert({
            nom: client,
            email: email || null,
            telephone: telephone || null,
            adresse: adresse || null,
            source: 'app',
            premiere_intervention: new Date().toISOString(),
            derniere_intervention: new Date().toISOString(),
            created_at: new Date().toISOString()
          });
        }
        console.log(`✅ Fiche client mise à jour : ${client}`);
      } catch(e) {
        console.log('Client upsert (non bloquant):', e.message);
      }
    }

    if (CONFIG.features.email_auto && email) {
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');
      const detailsPath = path.join(__dirname, `_details_${num}.json`);
      const pyPath = path.join(__dirname, `_devis_${num}.py`);
      const pdfPath = path.join(__dirname, `${num}.pdf`);

      const detailsData = prestations.map(p => ({ designation: p.nom, qte: p.quantite, prixUnit: p.prix, total: p.prix * p.quantite, details: p.desc ? [p.desc] : [] }));
      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const clientEsc = String(client || '').replace(/'/g, ' ');
      const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
      const clientTel = String(telephone || '').trim();
      const adresseRaw = String(adresse || '').replace(/'/g, ' ').trim();
      const adresseParts = adresseRaw.split(',').map(s => s.trim()).filter(Boolean);
      const clientRue = adresseParts.length >= 2 && adresseParts[0].match(/^\d+$/) ? adresseParts[0] + ' ' + adresseParts[1] : adresseParts[0] || '';
      const cpMatch = adresseRaw.match(/\b(\d{5})\b/);
      const clientCP = String(codePostal || '').trim() || (cpMatch ? cpMatch[1] : '');
      const villeManuelle = String(ville || '').trim();
      const villeGPS = adresseParts.find(p => p.length > 2 && p.length < 30 && !p.match(/^\d{5}/) && !p.toLowerCase().includes('france')) || '';
      const clientCPVille = [clientCP, villeManuelle || villeGPS].filter(Boolean).join(' ');
      const descObjet = String(description || 'Travaux d electricite generale').trim().replace(/'/g, ' ');

      const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import *
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus.flowables import HRFlowable
W,H=A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self):
        pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        else: self._draw_header_small()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',40); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Valable : ${dateValide}')
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,'${typeLabelUpper} N\\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()
        self._draw_tampons()
    def _draw_tampons(self):
        IS_PAYE = '${type}' == 'facture' and 'envoye' in ('paye', 'paye', 'payee', 'acquitte')
        IS_SIGNE = '${type}' == 'devis' and 'envoye' in ('signe', 'signe')
        rouge = colors.HexColor('#cc0000')
        vert  = colors.HexColor('#16a34a')
        if IS_PAYE:
            self.saveState()
            cx = W - 5.0*cm; cy = 9.0*cm; r = 1.9*cm
            self.setStrokeColor(rouge); self.setFillColor(rouge); self.setFillAlpha(0.72)
            self.setLineWidth(3); self.circle(cx,cy,r,fill=0,stroke=1)
            self.setLineWidth(1.2); self.circle(cx,cy,r-0.15*cm,fill=0,stroke=1)
            self.translate(cx,cy); self.rotate(-15)
            self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.0*cm,'SINELEC')
            self.setFont('Helvetica-Bold',22); self.drawCentredString(0,0.1*cm,'PAYE')
            self.setFont('Helvetica-Bold',7.5); self.drawCentredString(0,-0.55*cm,'${dateStr}')
            self.setFont('Helvetica',6.5); self.drawCentredString(0,-1.0*cm,'PARIS')
            self.restoreState()
        if IS_SIGNE:
            self.saveState()
            cx = W - 5.0*cm; cy = 9.0*cm; r = 1.9*cm
            self.setStrokeColor(vert); self.setFillColor(vert); self.setFillAlpha(0.72)
            self.setLineWidth(3); self.circle(cx,cy,r,fill=0,stroke=1)
            self.setLineWidth(1.2); self.circle(cx,cy,r-0.15*cm,fill=0,stroke=1)
            self.translate(cx,cy); self.rotate(-15)
            self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.0*cm,'SINELEC')
            self.setFont('Helvetica-Bold',19); self.drawCentredString(0,0.15*cm,'SIGNE')
            self.setFont('Helvetica-Bold',7.5); self.drawCentredString(0,-0.55*cm,'${dateStr}')
            self.setFont('Helvetica',6.5); self.drawCentredString(0,-1.0*cm,'PARIS')
            self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p('${descObjet}',10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100  \\u2022  Garantie decennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))
client_rows=[[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)]]
if '${clientRue}': client_rows.append([p('${clientRue}',8.5,color=GRIS_TEXTE)])
if '${clientComplement}': client_rows.append([p('${clientComplement}',8.5,color=GRIS_TEXTE)])
if '${clientCPVille}': client_rows.append([p('${clientCPVille}',8.5,color=GRIS_TEXTE)])
if '${clientTel}': client_rows.append([p('Tel : ${clientTel}',8.5,color=GRIS_SOFT)])
client_b=Table(client_rows,colWidths=[9.0*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(Table([[objet_b,client_b]],colWidths=[8.7*cm,9.5*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.6*cm))
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \\u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \\u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7.5,'Helvetica-Oblique',color=GRIS_SOFT),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
row_idx=1; bg=True
for l in data:
    nb=1+len(l.get('details',[])); c=BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),c)); ts.append(('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LIGNE))
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \\u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))
net=Table([[p('NET \\u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.35*cm))
story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LIGNE,spaceAfter=8))
IS_DEVIS = '${type}' == 'devis'
IS_PAYE = False
if IS_DEVIS:
    story.append(p('CONDITIONS',8,'Helvetica-Bold',MARINE,sa=6))
    cond=Table([[p('Acompte 40% a la signature',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.4),9,'Helvetica-Bold',OR_FONCE,TA_RIGHT)],[p('Solde a la fin des travaux',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.6),9,align=TA_RIGHT)],[p('Validite 30 jours  \\u2022  Virement, especes, CB',8,color=GRIS_SOFT),'']],colWidths=[14.2*cm,4.0*cm])
    cond.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,1),0.3,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('SPAN',(0,2),(1,2))]))
    story.append(cond); story.append(Spacer(1,0.15*cm))
else:
    story.append(p('MODALITES DE PAIEMENT',8,'Helvetica-Bold',MARINE,sa=6))
    pays=Table([[p('Virement bancaire',9,color=GRIS_TEXTE),p('IBAN ci-dessous',8,color=GRIS_SOFT,align=TA_RIGHT)],[p('Especes',9,color=GRIS_TEXTE),p('Remis en main propre',8,color=GRIS_SOFT,align=TA_RIGHT)],[p('Carte bancaire',9,color=GRIS_TEXTE),p('Terminal SumUp',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[8.0*cm,10.2*cm])
    pays.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,-2),0.3,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
    story.append(pays); story.append(Spacer(1,0.15*cm))
iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_SOFT),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',MARINE),p('BIC',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_OK')
`;
      fs.writeFileSync(pyPath, py, 'utf8');
      try {
        execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
      } catch(pyErr) { throw new Error('PDF generation failed: ' + pyErr.message); }

      const pdfB64 = fs.readFileSync(pdfPath).toString('base64');
      const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
      const lienSig = `${appUrl}/signer/${num}`;
      const htmlFinal = (type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture).replace(/\{num\}/g, num).replace(/\{lien_signature\}/g, lienSig);
      await envoyerEmail(email, `${type === 'devis' ? 'Devis' : 'Facture'} SINELEC ${num}`, htmlFinal, { content: pdfB64, name: `${num}.pdf` });
      try { await envoyerEmail('sinelec.paris@gmail.com', `${type === 'devis' ? '📋 DEVIS' : '💶 FACTURE'} ${num} — ${client} — ${parseFloat(total_ht).toFixed(0)}€`, `<p>Client: ${client} | Montant: ${parseFloat(total_ht).toFixed(2)}€</p>`, { content: pdfB64, name: `${num}.pdf` }); } catch(e) {}
      try { fs.unlinkSync(pyPath); } catch(e) {}
      try { fs.unlinkSync(detailsPath); } catch(e) {}
      try { fs.unlinkSync(pdfPath); } catch(e) {}
    }

    // ⚠️ Pas de SMS avis Google ici — envoyé uniquement au moment du paiement

    res.json({ success: true, num, total_ht });
  } catch(error) {
    console.error('Erreur génération:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: CHATBOT
// ═══════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  if (!CONFIG.features.chatbot_claude) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { message } = req.body;
    const grille = await chargerGrilleTarifaire();
    const grilleResume = Object.entries(grille || {}).map(([cat, items]) => `${cat}: ${items.map(i => `${i.nom} (${i.prix}€)`).join(', ')}`).join('\n');
    const prompt = `Tu es l'assistant SINELEC Paris. Chantier: "${message}"\nGRILLE:\n${grilleResume}\nRéponds UNIQUEMENT en JSON: {"prestations":[{"nom":"...","quantite":1,"prix":90,"desc":"..."}],"total":0,"explication":"...","hors_grille":[]}`;
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: prompt }] });
    let text = '';
    for (const block of response.content) { if (block.type === 'text') text += block.text; }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let result = jsonMatch ? JSON.parse(jsonMatch[0]) : { prestations: [], explication: text, total: 0 };
    if (!result.total && result.prestations) result.total = result.prestations.reduce((s, p) => s + (p.prix * p.quantite), 0);
    res.json(result);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: SIGNATURE
// ═══════════════════════════════════════════════════

app.get('/signer/:num', async (req, res) => {
  const { num } = req.params;
  const { data: devis, error } = await supabase.from('historique').select('*').eq('num', num).single();
  if (error || !devis) return res.status(404).send('<html><body><h2>Document introuvable</h2></body></html>');
  if (devis.statut === 'signe' || devis.statut === 'signé') return res.send('<html><body style="text-align:center;padding:40px;"><h2>Devis déjà signé ✅</h2><p>SINELEC Paris</p></body></html>');

  const montant = parseFloat(devis.total_ht || 0).toFixed(2);
  const prestationsHtml = (devis.prestations || []).map(p => `<tr><td style="padding:10px;">${p.nom||''}</td><td style="text-align:center;">${p.quantite||1}</td><td style="text-align:right;color:#C9A84C;">${parseFloat(p.prix||0).toFixed(2)} €</td></tr>`).join('');

  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Signer ${num}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,sans-serif;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;padding:16px;}.header{background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:20px;padding:24px;text-align:center;margin-bottom:16px;}.card{background:white;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 16px rgba(0,0,0,0.06);}.label{font-size:11px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;}.total{background:#1B2A4A;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;}.canvas-wrap{border:2px dashed #ddd;border-radius:12px;background:#fafafa;position:relative;overflow:hidden;cursor:crosshair;}.btn-sign{width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;border:none;border-radius:16px;padding:18px;font-size:16px;font-weight:800;cursor:pointer;margin-top:8px;}.btn-sign:disabled{opacity:0.4;}.btn-clear{background:none;border:1px solid #ddd;border-radius:8px;padding:8px 16px;font-size:12px;color:#888;cursor:pointer;margin-top:8px;}.success{display:none;text-align:center;padding:40px;}</style></head>
<body><div class="container">
  <div class="header"><h1 style="color:white;font-size:22px;font-weight:900;">⚡ SINELEC Paris</h1><p style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Signature électronique — N° ${num}</p></div>
  <div id="main-content">
    <div class="card"><div class="label">📋 Récapitulatif</div>
      <p style="font-size:15px;font-weight:700;color:#1B2A4A;">${devis.client||''}</p>
      <p style="font-size:12px;color:#888;margin-bottom:12px;">${devis.adresse||''}</p>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f8f9fa;"><th style="padding:10px;text-align:left;">Prestation</th><th style="text-align:center;">Qté</th><th style="text-align:right;">Prix HT</th></tr></thead><tbody>${prestationsHtml}</tbody></table>
      <div class="total"><span style="color:white;font-weight:700;">NET À PAYER</span><span style="color:#C9A84C;font-size:22px;font-weight:900;">${montant} €</span></div>
    </div>
    <div class="card"><div class="label">✅ Conditions</div>
      <p style="font-size:13px;color:#555;">✅ CGV SINELEC Paris — Montant: <strong style="color:#C9A84C;">${montant} €</strong> HT — Acompte: <strong style="color:#C9A84C;">${(parseFloat(montant)*0.4).toFixed(2)} €</strong></p>
    </div>
    <div class="card"><div class="label">✍️ Votre signature</div>
      <div class="canvas-wrap" id="canvas-wrap"><canvas id="sig-canvas" height="180" style="display:block;width:100%;touch-action:none;"></canvas><div id="canvas-placeholder" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ccc;font-size:13px;pointer-events:none;">Signez ici</div></div>
      <button class="btn-clear" onclick="clearCanvas()">🗑️ Effacer</button>
    </div>
    <button class="btn-sign" id="btn-sign" disabled onclick="soumettre()">✍️ Signer et valider</button>
    <p style="font-size:11px;color:#aaa;text-align:center;margin-top:12px;padding-bottom:24px;">Signature électronique légalement valide</p>
  </div>
  <div class="success" id="success-block"><div style="font-size:72px;">✅</div><h2 style="color:#1B2A4A;margin:16px 0;">Signé !</h2><p style="color:#555;">Merci <strong>${devis.client||''}</strong> !<br><br><span style="color:#C9A84C;font-weight:700;">SINELEC Paris — 07 87 38 86 22</span></p></div>
</div>
<script>
let hasDrawn=false,isDrawing=false,canvas,ctx;
function initCanvas(){
  canvas=document.getElementById('sig-canvas');
  const wrap=document.getElementById('canvas-wrap');
  const dpr=window.devicePixelRatio||1; const w=wrap.getBoundingClientRect().width||320;
  canvas.width=w*dpr; canvas.height=180*dpr; canvas.style.width=w+'px'; canvas.style.height='180px';
  ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.strokeStyle='#1B2A4A'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round';
  canvas.addEventListener('mousedown',e=>{e.preventDefault();startDraw(e.offsetX,e.offsetY);});
  canvas.addEventListener('mousemove',e=>{e.preventDefault();if(isDrawing)draw(e.offsetX,e.offsetY);});
  canvas.addEventListener('mouseup',()=>stopDraw());
  canvas.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];const r=canvas.getBoundingClientRect();startDraw(t.clientX-r.left,t.clientY-r.top);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!isDrawing)return;const t=e.touches[0];const r=canvas.getBoundingClientRect();draw(t.clientX-r.left,t.clientY-r.top);},{passive:false});
  canvas.addEventListener('touchend',e=>{e.preventDefault();stopDraw();},{passive:false});
}
function startDraw(x,y){isDrawing=true;ctx.beginPath();ctx.moveTo(x,y);document.getElementById('canvas-placeholder').style.display='none';}
function draw(x,y){ctx.lineTo(x,y);ctx.stroke();ctx.beginPath();ctx.moveTo(x,y);hasDrawn=true;document.getElementById('btn-sign').disabled=false;}
function stopDraw(){isDrawing=false;}
function clearCanvas(){if(ctx){const dpr=window.devicePixelRatio||1;ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);}hasDrawn=false;document.getElementById('canvas-placeholder').style.display='block';document.getElementById('btn-sign').disabled=true;}
async function soumettre(){
  const btn=document.getElementById('btn-sign');btn.disabled=true;btn.textContent='⏳ Envoi...';
  try{
    const res=await fetch('/api/signature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:'${num}',signature:canvas.toDataURL('image/png'),cgv_acceptees:true})});
    const data=await res.json();
    if(data.success){document.getElementById('main-content').style.display='none';document.getElementById('success-block').style.display='block';}
    else{btn.disabled=false;btn.textContent='✍️ Signer';alert('Erreur: '+(data.error||'Réessayez'));}
  }catch(e){btn.disabled=false;btn.textContent='✍️ Signer';alert('Erreur réseau.');}
}
setTimeout(initCanvas,300);
</script></body></html>`);
});

app.post('/api/signature', async (req, res) => {
  if (!CONFIG.features.signature_client) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { num, signature, cgv_acceptees } = req.body;
    const now = new Date();
    const ipClient = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'N/A';
    const { data: devisData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!devisData) return res.status(404).json({ error: 'Devis introuvable' });

    await supabase.from('signatures').insert({ num, signature, cgv_acceptees: cgv_acceptees || false, date_signature: now.toISOString(), ip_client: ipClient });
    await supabase.from('historique').update({ signature, statut: 'signe', date_signature: now.toISOString(), cgv_acceptees: cgv_acceptees || false }).eq('num', num);

    const montant = parseFloat(devisData.total_ht || 0);
    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const lienRdv = `${appUrl}/rdv/${num}`;
    const prenom = (devisData.client || '').split(' ')[0];

    // Email lien RDV — seulement si intervention planifiée
    if (devisData.email && devisData.intervention_type === 'planifie') {
      try {
        await envoyerEmail(devisData.email,
          `⚡ SINELEC Paris — Choisissez votre date d'intervention`,
          `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
            <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;">
              <div style="font-size:36px;margin-bottom:8px;">⚡</div>
              <h2 style="color:#fff;margin:0;font-size:20px;">SINELEC Paris</h2>
              <p style="color:#BFC8D6;margin-top:6px;font-size:13px;">Votre devis est signé ✅</p>
            </div>
            <div style="padding:28px;">
              <p style="color:#333;font-size:15px;margin-bottom:8px;">Bonjour <strong>${prenom}</strong>,</p>
              <p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:20px;">
                Votre devis <strong>${num}</strong> de <strong>${montant.toFixed(0)}€</strong> a bien été signé.<br>
                Il ne vous reste plus qu'à choisir votre créneau d'intervention !
              </p>
              <div style="text-align:center;margin:24px 0;">
                <a href="${lienRdv}" style="background:linear-gradient(135deg,#C9A84C,#daa520);color:#fff;text-decoration:none;border-radius:14px;padding:16px 32px;font-size:16px;font-weight:800;display:inline-block;">
                  📅 Choisir ma date d'intervention
                </a>
              </div>
              <p style="color:#999;font-size:12px;text-align:center;line-height:1.6;">
                Créneaux disponibles du lundi au samedi, 8h à 20h<br>
                Votre créneau sera confirmé par email dans les 2h
              </p>
            </div>
            <div style="background:#f8f8f8;padding:14px;text-align:center;">
              <p style="color:#999;font-size:11px;">SINELEC Paris • 07 87 38 86 22 • sinelec.paris@gmail.com</p>
            </div>
          </div></body></html>`
        );
      } catch(e) { console.error('Email RDV:', e.message); }
    }

    const htmlConfirm = `<html><body style="font-family:Arial;padding:20px;"><h2>✅ Devis ${num} signé</h2><p>Client: ${devisData.client||''} — Montant: ${montant.toFixed(2)} € — Acompte: ${(montant*0.4).toFixed(2)} €</p><p>IP: ${ipClient} — Date: ${now.toLocaleDateString('fr-FR')}</p></body></html>`;
    try { await envoyerEmail('sinelec.paris@gmail.com', `🔔 SIGNÉ — ${num} — ${devisData.client||''} — ${montant.toFixed(0)}€`, htmlConfirm); } catch(e) {}

    // ── RÉGÉNÉRER PDF AVEC SIGNATURE + ENVOYER AU CLIENT ──
    if (devisData.email) {
      try {
        const sigB64 = signature.replace(/^data:image\/png;base64,/, '');
        const dateStr = now.toLocaleDateString('fr-FR');
        const dateSig = now.toLocaleDateString('fr-FR');
        const clientEsc = String(devisData.client || '').replace(/'/g, ' ');
        const adresseParts = (devisData.adresse || '').split(',');
        const clientRue = String(adresseParts[0] || '').trim().replace(/'/g, ' ');
        const clientVille = adresseParts.slice(1).join(',').trim().replace(/'/g, ' ');
        const totalHT = parseFloat(devisData.total_ht || 0);
        const detailsData = (devisData.prestations || []).map(p => ({
          designation: p.nom || p.designation, qte: p.quantite || 1,
          prixUnit: p.prix || 0, total: (p.prix || 0) * (p.quantite || 1),
          details: p.desc ? [p.desc] : []
        }));

        const pyPath2 = path.join(__dirname, `_sig_${num}.py`);
        const detPath2 = path.join(__dirname, `_sig_details_${num}.json`);
        const pdfPath2 = path.join(__dirname, `_sig_${num}.pdf`);
        fs.writeFileSync(detPath2, JSON.stringify(detailsData));

        const pySig = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT; from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader; from reportlab.platypus.flowables import HRFlowable
W,H=A4; MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
VERT=colors.HexColor('#16a34a')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open('${detPath2}',encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
sig_bytes=base64.b64decode('${sigB64}')
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        else: self._draw_header_small()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(BLANC); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',40); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'DEVIS')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}')
        # Tampon SIGNÉ rond vert
        self.saveState()
        cx=W-5.0*cm; cy=H/2+1.0*cm; r=1.9*cm
        self.setStrokeColor(VERT); self.setFillColor(VERT); self.setFillAlpha(0.75)
        self.setLineWidth(3); self.circle(cx,cy,r,fill=0,stroke=1)
        self.setLineWidth(1.2); self.circle(cx,cy,r-0.15*cm,fill=0,stroke=1)
        self.translate(cx,cy); self.rotate(-15)
        self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.0*cm,'SINELEC')
        self.setFont('Helvetica-Bold',19); self.drawCentredString(0,0.15*cm,'SIGNE')
        self.setFont('Helvetica-Bold',7.5); self.drawCentredString(0,-0.55*cm,'${dateSig}')
        self.setFont('Helvetica',6.5); self.drawCentredString(0,-1.0*cm,'PARIS')
        self.restoreState()
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,'DEVIS N\\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState(); self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI \\u2022 128 Rue La Boetie 75008 Paris \\u2022 SIRET : 91015824500019 \\u2022 TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}'); self.restoreState()
doc=SimpleDocTemplate('${pdfPath2}',pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p('${String(devisData.description || 'Travaux electricite').replace(/'/g,' ')}',10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100 \\u2022 Garantie decennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${clientRue}',8.5,color=GRIS_TEXTE)],[p('${clientVille}',8.5,color=GRIS_TEXTE)]],colWidths=[9.0*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(Table([[objet_b,client_b]],colWidths=[8.7*cm,9.5*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.6*cm))
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \\u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \\u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7.5,'Helvetica-Oblique',color=GRIS_SOFT),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
row_idx=1; bg=True
for l in data:
    nb=1+len(l.get('details',[])); c2=BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),c2)); ts.append(('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LIGNE))
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \\u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))
net=Table([[p('NET \\u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.35*cm))
story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LIGNE,spaceAfter=8))
cond=Table([[p('Acompte 40% a la signature',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.4),9,'Helvetica-Bold',OR_FONCE,TA_RIGHT)],[p('Solde a la fin des travaux',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.6),9,align=TA_RIGHT)],[p('Validite 30 jours \\u2022 Virement, especes, CB',8,color=GRIS_SOFT),'']],colWidths=[14.2*cm,4.0*cm])
cond.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,1),0.3,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('SPAN',(0,2),(1,2))]))
story.append(cond); story.append(Spacer(1,0.3*cm))
story.append(HRFlowable(width='100%',thickness=0.5,color=VERT,spaceAfter=8))
t_sig_lbl=Table([[p('SIGNATURE CLIENT',8,'Helvetica-Bold',VERT,sa=0)]],colWidths=[18.2*cm])
t_sig_lbl.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
story.append(t_sig_lbl)
t_mention=Table([[p('Bon pour accord — Devis recu avant execution des travaux',9,'Helvetica-Bold',MARINE),p('Lu et approuve — Signe le : ${dateSig}',9,'Helvetica-Oblique',GRIS_SOFT,TA_RIGHT)]],colWidths=[11.0*cm,7.2*cm])
t_mention.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
story.append(t_mention)
sig_img=Image(io.BytesIO(sig_bytes),width=7.0*cm,height=2.5*cm)
sig_img.hAlign='LEFT'
story.append(sig_img)
iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_SOFT),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',MARINE),p('BIC',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(Spacer(1,0.2*cm)); story.append(iban)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_SIG_OK')
`;
        fs.writeFileSync(pyPath2, pySig, 'utf8');
        const { execSync: execS } = require('child_process');
        execS(`python3 ${pyPath2} ${detPath2} ${pdfPath2}`, { cwd: __dirname });
        const pdfB64 = fs.readFileSync(pdfPath2).toString('base64');

        // Envoyer au client avec PDF signé en pièce jointe
        await envoyerEmail(devisData.email,
          `✅ SINELEC Paris — Votre devis ${num} signé`,
          `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;">
              <div style="font-size:40px;">✅</div>
              <h2 style="color:#fff;margin:8px 0 0;">Devis signé !</h2>
            </div>
            <div style="padding:28px;">
              <p style="color:#333;font-size:14px;margin-bottom:16px;">Bonjour <strong>${prenom}</strong>,</p>
              <p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:16px;">
                Votre devis <strong>${num}</strong> de <strong>${montant.toFixed(0)} €</strong> est bien signé.<br>
                Vous trouverez ci-joint votre exemplaire avec votre signature.
              </p>
              <div style="background:#f0f7f0;border:1px solid rgba(22,163,74,0.2);border-left:4px solid #16a34a;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
                <p style="color:#15803d;font-size:13px;font-weight:700;margin:0;">
                  📋 Bon pour accord — Devis reçu avant exécution des travaux
                </p>
              </div>
              <p style="color:#999;font-size:12px;line-height:1.6;">
                Pour toute question :<br>
                📞 07 87 38 86 22 | sinelec.paris@gmail.com
              </p>
            </div>
            <div style="background:#f8f8f8;padding:14px;text-align:center;">
              <p style="color:#999;font-size:11px;">SINELEC Paris • sinelec.paris@gmail.com</p>
            </div>
          </div></body></html>`,
          { content: pdfB64, name: `Devis_SINELEC_${num}_Signe.pdf` }
        );

        // Nettoyage
        try { fs.unlinkSync(pyPath2); fs.unlinkSync(detPath2); fs.unlinkSync(pdfPath2); } catch(e) {}
        console.log(`✅ PDF signé envoyé à ${devisData.email}`);
      } catch(e) {
        console.error('PDF signé:', e.message);
      }
    }

    res.json({ success: true });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: HISTORIQUE + OBAT
// ═══════════════════════════════════════════════════

app.get('/api/historique', async (req, res) => {
  if (!CONFIG.features.historique) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { type } = req.query;
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    if (type && type !== 'tous') query = query.eq('type', type);
    const { data: histo, error } = await query;
    if (error) throw error;

    let obatFormate = [];
    if (!type || type === 'tous' || type === 'facture') {
      const { data: obat } = await supabase.from('factures_obat').select('*').eq('statut', 'Payée');
      obatFormate = (obat || []).map(f => ({ type: 'facture', client: f.client, total_ht: f.montant, statut: 'paye', created_at: f.date_facture + 'T00:00:00.000Z', num: f.reference, prestations: [{ nom: f.chantier, prix: f.montant, quantite: 1 }], source: 'obat' }));
    }

    const tout = [...(histo || []), ...obatFormate].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(tout);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/historique/:num', async (req, res) => {
  try {
    const { error } = await supabase.from('historique').delete().eq('num', req.params.num);
    if (error) throw error;
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/historique/:num/statut', async (req, res) => {
  try {
    const updates = {};
    if (req.body.statut !== undefined) updates.statut = req.body.statut;
    if (req.body.date_intervention !== undefined) {
      updates.date_intervention = req.body.date_intervention || null;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('historique').update(updates).eq('num', req.params.num);
    }
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: CA COMPLET
// ═══════════════════════════════════════════════════

app.get('/api/ca-complet', async (req, res) => {
  try {
    const { data: histo } = await supabase.from('historique').select('*').order('created_at', { ascending: false });
    const { data: obat } = await supabase.from('factures_obat').select('*').eq('statut', 'Payée');
    const obatFormate = (obat || []).map(f => ({
      type: 'facture', client: f.client, total_ht: f.montant,
      montant_diahe: f.montant, // Obat = 100% Diahe
      statut: 'paye', created_at: f.date_facture + 'T00:00:00.000Z',
      num: f.reference, prestations: [{ nom: f.chantier, prix: f.montant, quantite: 1 }], source: 'obat'
    }));
    // Enrichir chaque doc avec montant_diahe
    const histoEnrichi = (histo || []).map(h => {
      const pdiahe = h.part_diahe || 100;
      const montant_diahe = parseFloat(h.total_ht || 0) * pdiahe / 100;
      return { ...h, montant_diahe };
    });
    res.json([...histoEnrichi, ...obatFormate]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vérifier si un devis a été signé (polling depuis l'app)
app.get('/api/historique/:num/check-signature', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('historique').select('statut, signature, date_signature').eq('num', req.params.num).single();
    if (!data) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ statut: data.statut, signe: data.statut === 'signe', date_signature: data.date_signature });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CHARGES (MODULE RENTABILITÉ)
// ═══════════════════════════════════════════════════

// Lister charges d'un mois
app.get('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { mois } = req.query;
    let query = supabase.from('charges').select('*').order('date', { ascending: false });
    if (mois) query = query.eq('mois', mois);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ajouter une charge
app.post('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { date, categorie, montant, note } = req.body;
    if (!categorie || !montant) return res.status(400).json({ error: 'Champs manquants' });
    const dateCharge = date || new Date().toISOString().split('T')[0];
    const mois = dateCharge.substring(0, 7); // YYYY-MM
    const { data, error } = await supabase.from('charges').insert({ date: dateCharge, mois, categorie, montant: parseFloat(montant), note: note || null }).select().single();
    if (error) throw error;
    res.json({ success: true, charge: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Supprimer une charge
app.delete('/api/charges/:id', authMiddleware, async (req, res) => {
  try {
    await supabase.from('charges').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dashboard rentabilité d'un mois
app.get('/api/rentabilite/:mois', authMiddleware, async (req, res) => {
  try {
    const { mois } = req.params; // YYYY-MM

    // CA du mois (part Diahe uniquement)
    const { data: factures } = await supabase.from('historique')
      .select('total_ht, part_diahe, statut')
      .like('created_at', `${mois}%`)
      .eq('type', 'facture');

    const { data: obat } = await supabase.from('factures_obat')
      .select('montant')
      .like('date_facture', `${mois}%`)
      .eq('statut', 'Payée');

    const caFactures = (factures || [])
      .filter(f => ['paye','payé','payée'].includes((f.statut||'').toLowerCase()))
      .reduce((s, f) => s + parseFloat(f.total_ht || 0) * (f.part_diahe || 100) / 100, 0);
    const caObat = (obat || []).reduce((s, f) => s + parseFloat(f.montant || 0), 0);
    const ca_total = caFactures + caObat;

    // Charges du mois
    const { data: charges } = await supabase.from('charges').select('*').eq('mois', mois);
    const charges_manuelles = (charges || []).reduce((s, c) => s + parseFloat(c.montant || 0), 0);

    // Par catégorie
    const par_categorie = {};
    (charges || []).forEach(c => {
      par_categorie[c.categorie] = (par_categorie[c.categorie] || 0) + parseFloat(c.montant || 0);
    });

    // URSSAF auto 22% — uniquement si pas déjà saisie manuellement
    const urssaf_saisie = par_categorie['urssaf'] || 0;
    const urssaf_auto = urssaf_saisie > 0 ? 0 : Math.round(ca_total * 0.22);
    const urssaf_estimee = urssaf_auto; // pour l'alerte front

    // Charges totales = manuelles + URSSAF auto si absente
    const charges_total = charges_manuelles + urssaf_auto;

    const benefice_net = ca_total - charges_total;
    const taux_marge = ca_total > 0 ? Math.round((benefice_net / ca_total) * 100) : 0;

    res.json({
      mois, ca_total: Math.round(ca_total), charges_total: Math.round(charges_total),
      benefice_net: Math.round(benefice_net), taux_marge,
      urssaf_auto: Math.round(urssaf_auto), urssaf_saisie: Math.round(urssaf_saisie),
      urssaf_estimee, par_categorie, charges: charges || []
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CLIENTS
// ═══════════════════════════════════════════════════

app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('*').order('nom', { ascending: true });
    if (error) throw error;
    const clientsAvecCA = await Promise.all((data || []).map(async (client) => {
      const { data: factures } = await supabase.from('factures_obat').select('montant').ilike('client', `%${client.nom}%`).eq('statut', 'Payée');
      const ca_total = (factures || []).reduce((s, f) => s + parseFloat(f.montant || 0), 0);
      return { ...client, ca_total, nb_interventions: (factures || []).length };
    }));
    res.json(clientsAvecCA);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: VOCAL IA
// ═══════════════════════════════════════════════════

app.post('/api/vocal', async (req, res) => {
  const { texte } = req.body;
  if (!texte) return res.status(400).json({ error: 'Texte manquant' });
  try {
    const response = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: `Tu es l'assistant SINELEC Paris. Client: "${texte}"\nRéponds en JSON: {"reponse":"...","prix":"...","upsell":"...","negocie":"..."}` }] });
    const result = JSON.parse(response.content[0].text.trim().replace(/```json|```/g, '').trim());
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: DPE
// ═══════════════════════════════════════════════════

app.post('/api/dpe', async (req, res) => {
  try {
    const { pdf_text, image_base64, image_type, images_base64 } = req.body;
    if (!pdf_text && !image_base64 && !(images_base64 && images_base64.length)) return res.status(400).json({ error: 'Fichier manquant' });

    const promptBase = `Tu es un expert électricien. Analyse ce DPE et identifie UNIQUEMENT les travaux électriques. Réponds UNIQUEMENT en JSON valide:\n{"logement":{"surface":65,"classe":"F","annee_construction":1975,"chauffage_electrique":"...","eau_chaude_electrique":"...","vmc":"...","tableau":"...","daaf":"..."},"resume":"...","recommandations":[{"id":"...","titre":"...","description":"...","priorite":"haute","prestations":[{"nom":"...","prix":450,"quantite":1}]}]}`;

    let messageContent;
    if (images_base64 && images_base64.length > 1) {
      messageContent = [...images_base64.slice(0, 10).map(img => ({ type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 } })), { type: 'text', text: promptBase }];
    } else if (image_base64 || (images_base64 && images_base64[0])) {
      const img = image_base64 ? { base64: image_base64, type: image_type } : images_base64[0];
      messageContent = [{ type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 } }, { type: 'text', text: promptBase }];
    } else {
      messageContent = promptBase + '\n\nDPE:\n' + pdf_text.substring(0, 20000);
    }

    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, messages: [{ role: 'user', content: messageContent }] });
    const result = JSON.parse(response.content[0].text.trim().replace(/```json|```/g, '').trim());
    result.recommandations = (result.recommandations || []).map(r => ({ ...r, total: (r.prestations || []).reduce((s, p) => s + p.prix * (p.quantite || 1), 0) }));
    result.total_general = result.recommandations.reduce((s, r) => s + r.total, 0);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: RAPPORT
// ═══════════════════════════════════════════════════

app.post('/api/rapport', async (req, res) => {
  if (!CONFIG.features.rapports_intervention) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { client, adresse, chantier } = req.body;
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}-${String(compteur).padStart(3, '0')}`;
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `Décris professionnellement ces travaux (2-3 phrases):\n${chantier}\nClient: ${client}` }] });
    const travaux = response.content[0].text;
    await supabase.from('rapports').insert({ num, client, adresse, travaux });
    res.json({ success: true, num, travaux });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: AGENDA
// ═══════════════════════════════════════════════════

app.get('/api/agenda', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agenda').select('*').order('date_intervention', { ascending: true }).order('heure', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel, statut } = req.body;
    const { data, error } = await supabase.from('agenda').insert({ prenom, nom, client: client || `${prenom} ${nom}`, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel: sms_rappel !== false, statut: statut || 'planifié', sms_veille_envoye: false, sms_matin_envoye: false }).select().single();
    if (error) throw error;
    res.json({ success: true, id: data.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agenda/:id', async (req, res) => {
  try {
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel } = req.body;
    const { error } = await supabase.from('agenda').update({ prenom, nom, client: client || `${prenom} ${nom}`, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel: sms_rappel !== false, sms_veille_envoye: false, sms_matin_envoye: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Modifier un champ de l'agenda (date, heure, notes...)
app.patch('/api/agenda/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body; // { date_intervention, heure, notes, etc. }
    const { error } = await supabase.from('agenda').update(updates).eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/agenda/:id/statut', async (req, res) => {
  try {
    const { error } = await supabase.from('agenda').update({ statut: req.body.statut }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/agenda/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('agenda').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agenda/materiel/:type', (req, res) => {
  const MATERIEL = { 'Dépannage': ['Multimètre', 'Pince ampèremétrique', 'Testeur de prise', 'Tournevis isolés', 'Wago lot 50', 'Disjoncteurs 10/16/20A', 'Câble 1.5+2.5mm²', 'Lampe frontale'], 'Tableau': ['Coffret 1 rangée', 'Disjoncteurs assortis', 'Différentiel 30mA type A', 'Câble 2.5mm²', 'Tournevis isolés', 'Multimètre'], 'VMC': ['Caisson VMC', 'Gaine flexible', 'Bouches extraction', 'Câble 1.5mm²', 'Perceuse + forets'], 'Installation': ['Câble 2.5mm² (20m)', 'Câble 1.5mm² (10m)', 'Goulotte 40x16', 'Prises 2P+T', 'Interrupteurs', 'Boîtes encastrement', 'Wago lot 100'], 'Autre': ['Multimètre', 'Tournevis isolés', 'Câbles assortis', 'Wago', 'Lampe frontale'] };
  const type = decodeURIComponent(req.params.type);
  res.json({ type, materiel: MATERIEL[type] || MATERIEL['Autre'] });
});

// ═══════════════════════════════════════════════════
// API: GRILLE
// ═══════════════════════════════════════════════════

app.get('/api/grille', async (req, res) => {
  try {
    const { data, error } = await supabase.from('grille_tarifaire').select('code, nom, prix_ht').eq('actif', true);
    if (error) throw error;
    res.json(data || []);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/grille/grouped', async (req, res) => {
  try {
    res.json(await chargerGrilleTarifaire() || {});
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: PDF DOWNLOAD
// ═══════════════════════════════════════════════════

app.get('/api/pdf/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !data) return res.status(404).json({ error: 'Document non trouvé' });

    const docType = data.type || (num.startsWith('OS-') ? 'devis' : 'facture');
    const docStatut = data.statut || '';
    const typeLabelUpper = docType === 'devis' ? 'DEVIS' : (docStatut === 'paye' || docStatut === 'payé' ? 'FACTURE ACQUITTEE' : 'FACTURE');
    const dateStr = new Date(data.date_envoi || data.created_at).toLocaleDateString('fr-FR');
    const dateValide = new Date(new Date(data.date_envoi || data.created_at).getTime() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

    const detailsPath = path.join(__dirname, `_dl_details_${num}.json`);
    const pyPath = path.join(__dirname, `_dl_${num}.py`);
    const pdfPath = path.join(__dirname, `_dl_${num}.pdf`);
    const detailsData = (data.prestations || []).map(p => ({ designation: p.nom || p.designation, qte: p.quantite || 1, prixUnit: p.prix || 0, total: (p.prix || 0) * (p.quantite || 1), details: p.desc ? [p.desc] : [] }));
    fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

    const clientEsc = String(data.client || '').replace(/'/g, ' ');
    const clientParts = (data.adresse || '').split(',');
    const clientRue = String(clientParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = clientParts.slice(1).join(',').trim().replace(/'/g, ' ');

    const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT; from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
W,H=A4; MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read()); totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0); self._draw_header(); self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica',7.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.3*cm,H-4.85*cm,'128 Rue La Boetie, 75008 Paris'); self.drawString(1.3*cm,H-5.1*cm,'07 87 38 86 22  |  sinelec.paris@gmail.com  |  SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',44); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(10*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}  |  Valable : ${dateValide}')
        ${docStatut === 'signe' || docStatut === 'signé' ? `
        self.saveState()
        self.translate(W/2, H/2)
        self.rotate(35)
        self.setFillColor(colors.HexColor('#16a34a'))
        self.setStrokeColor(colors.HexColor('#16a34a'))
        self.setLineWidth(3)
        self.roundRect(-3.5*cm,-1.0*cm,7.0*cm,2.0*cm,0.3*cm,fill=0,stroke=1)
        self.setFont('Helvetica-Bold',38)
        self.setFillAlpha(0.75)
        self.drawCentredString(0,0.3*cm,'SIGNE')
        self.setFont('Helvetica',10)
        self.setFillAlpha(0.6)
        self.drawCentredString(0,-0.5*cm,'${data.date_signature ? new Date(data.date_signature).toLocaleDateString("fr-FR") : ""}')
        self.restoreState()
        ` : ''}
    def _draw_footer(self):
        self.saveState(); self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI \\u2022 128 Rue La Boetie 75008 Paris \\u2022 SIRET : 91015824500019 \\u2022 TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}'); self.restoreState(); self._draw_tampons()
    def _draw_tampons(self):
        rouge = colors.HexColor('#cc0000')
        vert  = colors.HexColor('#16a34a')
        IS_PAYE = '${docStatut}' in ('paye', 'payé', 'payee', 'acquitte', 'acquitté')
        IS_SIGNE = '${docType}' == 'devis' and '${docStatut}' in ('signe', 'signé')
        couleur = rouge if IS_PAYE else (vert if IS_SIGNE else None)
        label   = 'PAYE' if IS_PAYE else ('SIGNE' if IS_SIGNE else None)
        if not couleur: return
        self.saveState()
        cx = W - 5.0*cm; cy = 9.0*cm; r = 1.9*cm
        self.setStrokeColor(couleur); self.setFillColor(couleur); self.setFillAlpha(0.72)
        self.setLineWidth(3); self.circle(cx,cy,r,fill=0,stroke=1)
        self.setLineWidth(1.2); self.circle(cx,cy,r-0.15*cm,fill=0,stroke=1)
        self.translate(cx,cy); self.rotate(-15)
        self.setFont('Helvetica-Bold',7); self.drawCentredString(0,1.0*cm,'SINELEC')
        sz = 22 if IS_PAYE else 19
        self.setFont('Helvetica-Bold',sz); self.drawCentredString(0,0.15*cm,label)
        self.setFont('Helvetica-Bold',7.5); self.drawCentredString(0,-0.55*cm,'${dateStr}')
        self.setFont('Helvetica',6.5); self.drawCentredString(0,-1.0*cm,'PARIS')
        self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm); story=[]
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${clientRue}',8.5,color=GRIS_TEXTE)],[p('${clientVille}',8.5,color=GRIS_TEXTE)]],colWidths=[18.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(client_b); story.append(Spacer(1,0.5*cm))
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \\u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \\u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
t=Table(rows,colWidths=cw); ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
for i in range(len(data)):
    bg=BLANC if i%2==0 else GRIS_BG; ts.extend([('BACKGROUND',(0,i+1),(-1,i+1),bg),('LINEBELOW',(0,i+1),(-1,i+1),0.3,GRIS_LIGNE)])
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \\u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)])); story.append(tt); story.append(Spacer(1,0.12*cm))
net=Table([[p('NET A PAYER',12,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')])); story.append(net)
IS_FACTURE = '${docType}' == 'facture'
if IS_FACTURE:
    story.append(Spacer(1,0.35*cm))
    from reportlab.platypus.flowables import HRFlowable
    story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LIGNE,spaceAfter=8))
    story.append(p('MODALITES DE PAIEMENT',8,'Helvetica-Bold',MARINE,sa=6))
    pays=Table([[p('Virement bancaire',9,color=GRIS_TEXTE),p('IBAN ci-dessous',8,color=GRIS_SOFT,align=TA_RIGHT)],[p('Especes',9,color=GRIS_TEXTE),p('Remis en main propre',8,color=GRIS_SOFT,align=TA_RIGHT)],[p('Carte bancaire',9,color=GRIS_TEXTE),p('Terminal SumUp',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[8.0*cm,10.2*cm])
    pays.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,-2),0.3,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
    story.append(pays)
${(docStatut === 'signe' || docStatut === 'signé') && data.signature ? `
sig_b64 = '${data.signature.replace(/^data:image\/png;base64,/, '')}'
sig_date_str = '${data.date_signature ? new Date(data.date_signature).toLocaleDateString("fr-FR") : dateStr}'
from reportlab.platypus.flowables import HRFlowable
story.append(Spacer(1,0.3*cm))
story.append(HRFlowable(width='100%',thickness=0.5,color=GRIS_LIGNE,spaceAfter=6))
sig_rows = [[p('SIGNATURE CLIENT',7,'Helvetica-Bold',OR,sa=0)]]
t_sig_lbl = Table(sig_rows,colWidths=[18.2*cm])
t_sig_lbl.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
story.append(t_sig_lbl)
t_mention = Table([[p('Bon pour accord - Devis recu avant execution des travaux',8,'Helvetica-Bold',MARINE),p('Lu et approuve - Signe le : '+sig_date_str,8,'Helvetica-Oblique',GRIS_SOFT,align=TA_RIGHT)]],colWidths=[11.0*cm,7.2*cm])
t_mention.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
story.append(t_mention)
sig_bytes = base64.b64decode(sig_b64)
sig_img = Image(io.BytesIO(sig_bytes),width=7.0*cm,height=2.5*cm)
sig_img.hAlign = 'LEFT'
story.append(sig_img)
` : ''}
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    try { execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' }); } catch(e) { throw new Error('PDF failed'); }
    const pdfBuffer = fs.readFileSync(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);
    try { fs.unlinkSync(pyPath); } catch(e) {}
    try { fs.unlinkSync(detailsPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: SUMUP
// ═══════════════════════════════════════════════════

app.post('/api/sumup/lien/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !data) return res.status(404).json({ error: 'Document non trouvé' });
    const montant = parseFloat(data.total_ht || 0);
    if (montant <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const checkoutRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkout_reference: `SINELEC-${num}-${Date.now()}`, amount: montant, currency: 'EUR', description: `SINELEC ${num}`, pay_to_email: process.env.SUMUP_EMAIL || 'sinelec.paris@gmail.com', redirect_url: `${appUrl}/paiement-confirme/${num}`, hosted_checkout: { enabled: true } }),
    });
    if (!checkoutRes.ok) { const err = await checkoutRes.text(); return res.status(500).json({ error: 'SumUp: ' + err }); }
    const checkout = await checkoutRes.json();
    const lienPaiement = checkout.hosted_checkout_url || checkout.checkout_url || `https://pay.sumup.com/b2c/checkout/${checkout.id}`;
    await supabase.from('historique').update({ lien_paiement: lienPaiement, checkout_id: checkout.id }).eq('num', num);

    const prenomClient = (data.client || 'client').split(' ')[0];
    const modeEnvoi = req.query.envoi || 'les2';
    if ((modeEnvoi === 'email' || modeEnvoi === 'les2') && data.email) {
      try { await envoyerEmail(data.email, `💳 Paiement SINELEC ${num} — ${montant.toFixed(2)} €`, `<html><body style="font-family:Arial;padding:20px;"><h2>⚡ SINELEC Paris</h2><p>Bonjour ${prenomClient},</p><p>Facture <strong>${num}</strong> — <strong>${montant.toFixed(2)} €</strong></p><p><a href="${lienPaiement}" style="background:#C9A84C;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:800;display:inline-block;margin-top:12px;">💳 Payer maintenant</a></p></body></html>`); } catch(e) {}
    }
    if ((modeEnvoi === 'sms' || modeEnvoi === 'les2') && data.telephone) {
      try { await envoyerSMS(data.telephone, `Bonjour ${prenomClient} 😊 Lien paiement sécurisé ${montant.toFixed(0)}EUR : ${lienPaiement} SINELEC Paris ⚡`); } catch(e) {}
    }
    res.json({ success: true, lien: lienPaiement, checkout_id: checkout.id, montant, num });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/paiement-confirme/:num', async (req, res) => {
  const { num } = req.params;
  try {
    await supabase.from('historique').update({ statut: 'paye', date_paiement: new Date().toISOString() }).eq('num', num);
    const { data: factureData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (factureData?.email) {
      setImmediate(async () => {
        try {
          const montant = parseFloat(factureData.total_ht || 0);
          const prenomClient = (factureData.client || 'client').split(' ')[0];
          const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#16a34a;">✅ Paiement reçu — Merci !</h2><p>Bonjour <b>${prenomClient}</b>, votre paiement de ${montant.toFixed(2)} € a bien été reçu.</p></body></html>`;
          await envoyerEmail(factureData.email, `✅ Facture SINELEC ${num} — Paiement reçu`, html);
          await envoyerEmail('sinelec.paris@gmail.com', `💰 PAIEMENT RECU — ${num} — ${factureData.client||''} — ${montant.toFixed(0)}€`, html);
          // SMS confirmation + avis Google en 1 seul message
          if (factureData.telephone) {
            await envoyerSMS(factureData.telephone, `Merci ${prenomClient} ! Paiement ${montant.toFixed(0)}€ reçu ✅ Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — SINELEC Paris ⚡`);
          }
        } catch(e) {}
      });
    }
  } catch(e) {}
  res.send(`<html><body style="text-align:center;padding:40px;font-family:Arial;"><div style="max-width:500px;margin:40px auto;background:white;border-radius:20px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.1);"><div style="font-size:64px;">✅</div><h2 style="color:#1B2A4A;">Paiement confirmé !</h2><p style="color:#555;">Référence : <strong style="color:#C9A84C;">${num}</strong></p><p style="color:#aaa;margin-top:20px;">SINELEC Paris — 07 87 38 86 22</p></div></body></html>`);
});

app.post('/api/marquer-paye', async (req, res) => {
  const { num, mode_paiement } = req.body;
  if (!num) return res.status(400).json({ error: 'Numéro manquant' });
  try {
    const modeLabel = mode_paiement === 'terminal' ? 'CB Terminal SumUp' : mode_paiement === 'virement' ? 'Virement bancaire' : 'Espèces';
    await supabase.from('historique').update({ statut: 'paye', date_paiement: new Date().toISOString(), mode_paiement: modeLabel }).eq('num', num);
    const { data: factureData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!factureData) return res.status(404).json({ error: 'Facture non trouvée' });
    res.json({ success: true, message: `Paiement ${modeLabel} enregistré` });
    setImmediate(async () => {
      try {
        const montant = parseFloat(factureData.total_ht || 0);
        const prenomClient = (factureData.client || 'client').split(' ')[0];
        const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#16a34a;">✅ Paiement reçu — ${modeLabel}</h2><p>Bonjour <b>${prenomClient}</b>, facture ${num} réglée — ${montant.toFixed(2)} €.</p></body></html>`;
        if (factureData.email) await envoyerEmail(factureData.email, `✅ Facture SINELEC ${num} — Paiement reçu`, html);
        await envoyerEmail('sinelec.paris@gmail.com', `💰 PAIEMENT ${modeLabel.toUpperCase()} — ${num} — ${factureData.client||''} — ${montant.toFixed(0)}€`, html);
        // SMS confirmation paiement + avis Google en 1 seul message
        if (factureData.telephone) {
          await envoyerSMS(factureData.telephone, `Merci ${prenomClient} ! Paiement ${montant.toFixed(0)}€ reçu ✅ Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — SINELEC Paris ⚡`);
        }
      } catch(e) {}
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// MONITORING
// ═══════════════════════════════════════════════════

const serviceStatus = {
  brevo_email: { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  brevo_sms:   { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  sumup:       { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  supabase:    { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  claude_api:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  pdf_python:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
};

async function mettreAJourStatut(service, ok, erreur = null) {
  const s = serviceStatus[service]; if (!s) return;
  s.status = ok ? 'ok' : 'error'; s.lastCheck = new Date().toISOString(); s.lastError = ok ? null : String(erreur || 'Erreur'); s.checks++; if (ok) s.uptime++;
  try { await supabase.from('monitoring').upsert({ service, status: s.status, last_check: s.lastCheck, last_error: s.lastError, uptime_pct: Math.round((s.uptime / s.checks) * 100) }, { onConflict: 'service' }); } catch(e) {}
}

async function verifierSante() {
  const erreurs = [];
  try { const { error } = await supabase.from('compteurs').select('valeur').limit(1); if (error) throw error; await mettreAJourStatut('supabase', true); } catch(e) { await mettreAJourStatut('supabase', false, e.message); erreurs.push('supabase'); }
  try { const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY } }); if (!r.ok) throw new Error('HTTP ' + r.status); await mettreAJourStatut('brevo_email', true); await mettreAJourStatut('brevo_sms', true); } catch(e) { await mettreAJourStatut('brevo_email', false, e.message); await mettreAJourStatut('brevo_sms', false, e.message); erreurs.push('brevo'); }
  try { if (SUMUP_API_KEY) { const r = await fetch('https://api.sumup.com/v0.1/me', { headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}` } }); if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status); await mettreAJourStatut('sumup', true); } } catch(e) { await mettreAJourStatut('sumup', false, e.message); erreurs.push('sumup'); }
  try { if (!process.env.ANTHROPIC_API_KEY) throw new Error('Clé manquante'); await mettreAJourStatut('claude_api', true); } catch(e) { await mettreAJourStatut('claude_api', false, e.message); erreurs.push('claude_api'); }
  try { execSync('python3 -c "import reportlab"', { timeout: 5000 }); await mettreAJourStatut('pdf_python', true); } catch(e) { await mettreAJourStatut('pdf_python', false, e.message); erreurs.push('pdf_python'); }
  return { ok: erreurs.length === 0, erreurs, status: serviceStatus };
}

app.get('/api/sante', async (req, res) => {
  try {
    const { data } = await supabase.from('monitoring').select('*');
    const result = {};
    for (const [service, status] of Object.entries(serviceStatus)) {
      const db = (data || []).find(r => r.service === service);
      result[service] = { ...status, uptime_pct: db?.uptime_pct || null };
    }
    res.json({ global: Object.values(result).every(s => s.status === 'ok' || s.status === 'unknown') ? 'ok' : 'degraded', services: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sante/verifier', async (req, res) => {
  try { res.json(await verifierSante()); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// VEILLE + RELANCES
// ═══════════════════════════════════════════════════

app.post('/api/veille/lancer', async (req, res) => {
  if (!CONFIG.features.veille_tarifaire) return res.status(403).json({ error: 'Feature désactivée' });
  res.json({ success: true, message: 'Veille tarifaire lancée' });
});

app.post('/api/relances/lancer', async (req, res) => {
  if (!CONFIG.features.relances_auto) return res.status(403).json({ error: 'Feature désactivée' });
  res.json({ success: true, message: 'Relances lancées' });
});

// ═══════════════════════════════════════════════════
// RAPPORT HEBDOMADAIRE
// ═══════════════════════════════════════════════════

async function rapportHebdomadaire() {
  try {
    const maintenant = new Date(); const lundiDernier = new Date(maintenant); lundiDernier.setDate(maintenant.getDate() - 7);
    const { data: docs } = await supabase.from('historique').select('*').gte('created_at', lundiDernier.toISOString());
    const factures = (docs || []).filter(d => d.type === 'facture');
    const devis = (docs || []).filter(d => d.type === 'devis');
    const caSemaine = factures.reduce((s, f) => s + parseFloat(f.total_ht || 0), 0);
    const { data: tousDevis } = await supabase.from('historique').select('*').eq('type', 'devis').in('statut', ['envoyé', 'envoye']);
    const devisARelancer = (tousDevis || []).filter(d => (new Date() - new Date(d.created_at)) / 3600000 > 48);
    const semaine = `${lundiDernier.toLocaleDateString('fr-FR')} → ${maintenant.toLocaleDateString('fr-FR')}`;
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2>📊 Rapport hebdomadaire SINELEC — ${semaine}</h2><p>CA facturé : <strong>${caSemaine.toFixed(2)} €</strong> (${factures.length} factures)</p><p>Devis envoyés : ${devis.length}</p><p>À relancer (+48h) : <strong style="color:#ef4444;">${devisARelancer.length}</strong></p><p><a href="https://sinelec-api-production.up.railway.app/app.html">📱 SINELEC OS</a></p></body></html>`;
    await envoyerEmail('sinelec.paris@gmail.com', `📊 Rapport SINELEC — CA: ${caSemaine.toFixed(0)}€ — ${devisARelancer.length} à relancer`, html);
  } catch(e) { console.error('Rapport hebdo:', e.message); }
}

app.post('/api/rapport-hebdo/tester', async (req, res) => {
  try { await rapportHebdomadaire(); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// CRONS
// ═══════════════════════════════════════════════════

// SMS veille 18h
cron.schedule('0 18 * * *', async () => {
  try {
    const demain = new Date(); demain.setDate(demain.getDate() + 1);
    const demainStr = demain.toISOString().split('T')[0];
    const { data } = await supabase.from('agenda').select('*').eq('date_intervention', demainStr).eq('sms_rappel', true).eq('sms_veille_envoye', false).neq('statut', 'annulé');
    for (const iv of (data || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      const dateLabel = demain.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
      await envoyerSMS(iv.telephone, `Bonjour ${prenom} ! Rappel intervention SINELEC demain ${dateLabel} à ${iv.heure}. Tel: 07 87 38 86 22 ⚡`);
      await supabase.from('agenda').update({ sms_veille_envoye: true }).eq('id', iv.id);
    }
  } catch(e) { console.error('SMS veille:', e.message); }
});

// SMS matin 8h45
cron.schedule('45 8 * * *', async () => {
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('agenda').select('*').eq('date_intervention', aujourdhui).eq('sms_rappel', true).eq('sms_matin_envoye', false).neq('statut', 'annulé');
    for (const iv of (data || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      await envoyerSMS(iv.telephone, `Bonjour ${prenom} 😊 Intervention SINELEC confirmée aujourd'hui à ${iv.heure}. Tel: 07 87 38 86 22 ⚡`);
      await supabase.from('agenda').update({ sms_matin_envoye: true }).eq('id', iv.id);
    }
  } catch(e) { console.error('SMS matin:', e.message); }
});

// Récap matin 7h
cron.schedule('0 7 * * *', async () => {
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const { data: liste } = await supabase.from('agenda').select('*').eq('date_intervention', aujourdhui).neq('statut', 'annulé').order('heure', { ascending: true });
    if (!liste || liste.length === 0) return;
    const rows = liste.map(iv => `<tr><td style="padding:8px;color:#C9A84C;font-weight:700;">${iv.heure}</td><td style="padding:8px;">${iv.client}</td><td style="padding:8px;color:#555;">${iv.adresse||'—'}</td><td style="padding:8px;">${iv.type_intervention}</td></tr>`).join('');
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2>☀️ Bonjour Diahe ! — ${dateLabel}</h2><p><strong>${liste.length}</strong> intervention(s)</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;"><tr style="background:#f8f9fa;"><th>Heure</th><th>Client</th><th>Adresse</th><th>Type</th></tr>${rows}</table></body></html>`;
    await envoyerEmail('sinelec.paris@gmail.com', `☀️ ${liste.length} intervention(s) aujourd'hui — SINELEC`, html);
  } catch(e) { console.error('Récap matin:', e.message); }
});

// Rapport hebdo lundi 8h
cron.schedule('0 8 * * 1', rapportHebdomadaire);

// Health check toutes les heures
cron.schedule('0 * * * *', verifierSante);

// Health check démarrage (2min)
setTimeout(() => { verifierSante().catch(() => {}); }, 120000);

// ═══════════════════════════════════════════════════
// CRON RELANCE FACTURES J+7 / J+14 — 8h chaque matin
// ═══════════════════════════════════════════════════
async function relancerFacturesImpayees() {
  try {
    const maintenant = new Date();
    const { data: factures } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'facture')
      .not('statut', 'in', '("paye","payé","payée","annule","annulé")')
      .not('telephone', 'is', null);

    if (!factures || !factures.length) return;

    let relancees = 0;

    for (const f of factures) {
      if (!f.telephone || !f.date_envoi) continue;

      const joursSinceEnvoi = Math.floor((maintenant - new Date(f.date_envoi)) / (1000 * 60 * 60 * 24));
      const nbRelances = f.nb_relances || 0;

      // J+7 : première relance
      // J+14 : deuxième et dernière relance
      const doitRelancer =
        (joursSinceEnvoi >= 7 && joursSinceEnvoi < 14 && nbRelances === 0) ||
        (joursSinceEnvoi >= 14 && nbRelances === 1);

      if (!doitRelancer) continue;

      const montant = parseFloat(f.total_ht || 0).toFixed(0);
      const prenom = (f.client || '').split(' ')[0];
      const relanceNum = nbRelances + 1;

      const msg = relanceNum === 1
        ? `Bonjour ${prenom}, votre facture SINELEC n°${f.num} d'un montant de ${montant}€ est en attente de règlement. Pour payer par CB : sinelec-api-production.up.railway.app/payer/${f.num} — Merci, Diahe SINELEC 07 87 38 86 22`
        : `Bonjour ${prenom}, rappel final : votre facture SINELEC n°${f.num} de ${montant}€ reste impayée. Merci de régulariser rapidement. Contact : 07 87 38 86 22 — SINELEC`;

      try {
        await envoyerSMS(f.telephone, msg);
        // Mettre à jour nb_relances et date_derniere_relance
        await supabase.from('historique').update({
          nb_relances: relanceNum,
          date_derniere_relance: new Date().toISOString()
        }).eq('num', f.num);
        relancees++;
        console.log(`📱 Relance J+${joursSinceEnvoi} envoyée → ${f.client} (${f.num})`);
      } catch(e) {
        console.error(`Relance ${f.num}:`, e.message);
      }
    }

    if (relancees > 0) {
      // Notifier Diahe par email
      await envoyerEmail(
        'sinelec.paris@gmail.com',
        `📱 ${relancees} relance(s) facture envoyée(s) — SINELEC`,
        `<h3>Relances automatiques du jour</h3><p>${relancees} client(s) relancé(s) pour facture impayée.</p>`
      );
    }

    console.log(`✅ Relances factures : ${relancees} envoyées`);
  } catch(e) {
    console.error('Cron relances:', e.message);
  }
}

// Lancer chaque matin à 9h05
cron.schedule('5 9 * * *', relancerFacturesImpayees);

// Route GET pour tester depuis le navigateur
app.get('/api/relances/lancer', authMiddleware, async (req, res) => {
  try {
    await relancerFacturesImpayees();
    res.json({ success: true, message: 'Relances lancées — vérifiez vos SMS et emails' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Lancer chaque matin à 9h05
cron.schedule('5 9 * * *', relancerFacturesImpayees);

// Route GET pour tester depuis le navigateur
app.get('/api/relances/lancer', authMiddleware, async (req, res) => {
  try {
    await relancerFacturesImpayees();
    res.json({ success: true, message: 'Relances lancées — vérifiez vos SMS et emails' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// IA AUTONOME — SURVEILLANCE + AUTO-CORRECTION
// ═══════════════════════════════════════════════════
// IA SINELEC — client Anthropic déjà initialisé en haut du fichier
// Log des erreurs en mémoire (buffer circulaire 100 entrées)
const errorLog = [];
const MAX_ERRORS = 100;

function logError(route, error, req_info) {
  errorLog.unshift({
    ts: new Date().toISOString(),
    route,
    error: error.message || String(error),
    stack: error.stack?.substring(0, 500) || '',
    req: req_info || ''
  });
  if (errorLog.length > MAX_ERRORS) errorLog.pop();
}

// Middleware global de capture d'erreurs
app.use((err, req, res, next) => {
  logError(req.path, err, `${req.method} ${req.path}`);
  res.status(500).json({ error: err.message });
});

// ── PUSH GITHUB ────────────────────────────────────
async function pushGitHub(filename, content, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'sinelecparis-del/sinelec-api';
  if (!token) throw new Error('GITHUB_TOKEN manquant');

  // Récupérer le SHA actuel du fichier
  const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  const getJson = await getRes.json();
  const sha = getJson.sha;

  // Encoder en base64
  const encoded = Buffer.from(content).toString('base64');

  // Push
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `🤖 IA SINELEC: ${message}`,
      content: encoded,
      sha
    })
  });
  const putJson = await putRes.json();
  if (!putJson.commit) throw new Error('Push GitHub échoué: ' + JSON.stringify(putJson).substring(0, 200));
  return putJson.commit.sha;
}

// ── ANALYSE IA ─────────────────────────────────────
async function analyserEtCorrigerErreurs() {
  try {
    if (errorLog.length === 0) return;

    // Récupérer le code actuel
    const fs = require('fs');
    const serverCode = fs.readFileSync(__filename, 'utf8');

    const erreurs = errorLog.slice(0, 10).map(e =>
      `[${e.ts}] ${e.req} → ${e.error}`
    ).join('\n');

    const prompt = `Tu es l'IA de maintenance de SINELEC OS, une app de gestion pour électricien.

ERREURS DÉTECTÉES :
${erreurs}

CODE SERVER.JS (extrait) :
${serverCode.substring(0, 8000)}

MISSION :
1. Analyse les erreurs
2. Si tu peux corriger dans server.js, fournis le code corrigé
3. Si c'est dans app.html, indique-le
4. Sois concis

RÉPONDS EN JSON :
{
  "severite": "critique|majeur|mineur",
  "diagnostic": "explication courte",
  "peut_corriger_auto": true|false,
  "correction_server": "code corrigé complet si applicable, sinon null",
  "message_diahe": "message clair pour Diahe"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    let analyse;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      analyse = JSON.parse(jsonMatch[0]);
    } catch(e) {
      console.log('IA analyse:', text.substring(0, 200));
      return;
    }

    console.log(`🤖 IA Analyse: ${analyse.severite} — ${analyse.diagnostic}`);

    // Sauvegarder l'analyse en base
    await supabase.from('ia_corrections').insert({
      date: new Date().toISOString(),
      severite: analyse.severite,
      diagnostic: analyse.diagnostic,
      peut_corriger: analyse.peut_corriger_auto,
      message: analyse.message_diahe,
      erreurs: erreurs,
      statut: 'en_attente'
    }).select();

    // Notifier Diahe
    const urgence = analyse.severite === 'critique' ? '🔴' : analyse.severite === 'majeur' ? '🟠' : '🟡';
    await envoyerEmail('sinelec.paris@gmail.com',
      `${urgence} SINELEC OS — ${analyse.severite.toUpperCase()} détecté`,
      `<html><body style="font-family:Arial;padding:20px;background:#f8f8f8;">
      <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
        <h2 style="color:#E8B84B;">🤖 IA SINELEC — Alerte ${analyse.severite}</h2>
        <p><strong>Diagnostic :</strong> ${analyse.diagnostic}</p>
        <p><strong>Message :</strong> ${analyse.message_diahe}</p>
        <p><strong>Correction auto disponible :</strong> ${analyse.peut_corriger_auto ? '✅ Oui' : '❌ Non — intervention manuelle requise'}</p>
        ${analyse.peut_corriger_auto ? `<p style="background:#e8f5e9;padding:12px;border-radius:8px;">👉 Va dans SINELEC OS → Santé → <strong>Appliquer la correction</strong></p>` : ''}
        <hr><p style="font-size:12px;color:#888;">Erreurs détectées : ${errorLog.length} | ${new Date().toLocaleString('fr-FR')}</p>
      </div></body></html>`
    );

  } catch(e) {
    console.error('IA analyse erreur:', e.message);
  }
}

// ── APPLIQUER CORRECTION ──────────────────────────
app.post('/api/ia/appliquer', authMiddleware, async (req, res) => {
  try {
    const { correction_id } = req.body;

    // Récupérer la correction en attente
    const { data: corrections } = await supabase
      .from('ia_corrections')
      .select('*')
      .eq('statut', 'en_attente')
      .eq('peut_corriger', true)
      .order('date', { ascending: false })
      .limit(1);

    if (!corrections || !corrections.length) {
      return res.json({ success: false, message: 'Aucune correction automatique disponible' });
    }

    const correction = corrections[0];

    // Re-analyser pour obtenir le code corrigé
    const fs = require('fs');
    const serverCode = fs.readFileSync(__filename, 'utf8');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `Voici le problème détecté sur SINELEC OS : ${correction.diagnostic}
Erreurs : ${correction.erreurs}

Code server.js actuel :
${serverCode}

Fournis le server.js complet corrigé. Réponds UNIQUEMENT avec le code JavaScript, sans explication ni balises markdown.`
      }]
    });

    const codeCorrige = response.content[0].text
      .replace(/^```javascript\n?/, '').replace(/^```js\n?/, '').replace(/```$/, '').trim();

    // Push sur GitHub
    const commitSha = await pushGitHub('server.js', codeCorrige,
      `Correction auto: ${correction.diagnostic.substring(0, 60)}`);

    // Mettre à jour le statut
    await supabase.from('ia_corrections')
      .update({ statut: 'appliqué', commit_sha: commitSha })
      .eq('id', correction.id);

    // Vider le log d'erreurs
    errorLog.length = 0;

    res.json({
      success: true,
      message: `✅ Correction appliquée ! Commit: ${commitSha.substring(0, 7)}. Railway redémarre dans 30 secondes.`
    });

  } catch(e) {
    console.error('Appliquer correction:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Créer ou mettre à jour une fiche client manuellement
app.post('/api/clients/creer', authMiddleware, async (req, res) => {
  try {
    const { nom, email, telephone, adresse } = req.body;
    if (!nom) return res.status(400).json({ error: 'Nom manquant' });

    // Chercher si client existe déjà
    let existant = null;
    if (email) {
      const { data } = await supabase.from('clients').select('*').eq('email', email).maybeSingle();
      existant = data;
    }
    if (!existant && telephone) {
      const { data } = await supabase.from('clients').select('*').eq('telephone', telephone).maybeSingle();
      existant = data;
    }

    if (existant) {
      await supabase.from('clients').update({
        nom, email: email || existant.email,
        telephone: telephone || existant.telephone,
        adresse: adresse || existant.adresse,
        derniere_intervention: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', existant.id);
      res.json({ success: true, created: false });
    } else {
      await supabase.from('clients').insert({
        nom, email: email || null, telephone: telephone || null,
        adresse: adresse || null, source: 'app',
        premiere_intervention: new Date().toISOString(),
        derniere_intervention: new Date().toISOString(),
        created_at: new Date().toISOString()
      });
      res.json({ success: true, created: true });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DESCRIPTION IA RAPPORT ────────────────────────
app.post('/api/rapport/description', authMiddleware, async (req, res) => {
  try {
    const { chantier, client, adresse } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content:
        `Tu es un électricien professionnel parisien (SINELEC Paris). Rédige un rapport d'intervention très détaillé et long, style assurance/expertise, pour les travaux suivants :

TRAVAUX : ${chantier}
CLIENT : ${client || 'Client'}
ADRESSE : ${adresse || 'Paris'}

Le rapport doit contenir :
1. Description technique détaillée de l'état initial de l'installation
2. Travaux réalisés étape par étape (méthodologie, matériaux utilisés, marques)
3. Tests et vérifications effectués (tensions mesurées, tests différentiels, continuité de terre)
4. Résultats et conformité NF C 15-100
5. Recommandations pour la suite

Style : professionnel, technique, détaillé comme un rapport d'assurance. Minimum 300 mots. Pas de titre, juste le corps du texte.`
      }]
    });
    const description = response.content[0].text.trim();
    res.json({ success: true, description });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── RAPPORT D'INTERVENTION ────────────────────────
app.post('/api/rapport', authMiddleware, async (req, res) => {
  if (!CONFIG.features.rapports_intervention) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { client, adresse, chantier, description, email, telephone, photo_avant, photo_apres } = req.body;
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${String(compteur).padStart(3,'0')}`;
    const dateStr = new Date().toLocaleDateString('fr-FR');

    // Sauvegarder en base
    await supabase.from('rapports').insert({
      num, client, adresse, chantier, description, email, telephone,
      date_rapport: new Date().toISOString()
    });

    // Générer PDF avec photos
    const pyPath = path.join(__dirname, `_rapp_${num}.py`);
    const pdfPath = path.join(__dirname, `_rapp_${num}.pdf`);

    const descEsc = String(description || chantier).replace(/'/g, ' ').replace(/\n/g, '\\n');
    const clientEsc = String(client || '').replace(/'/g, ' ');
    const adresseEsc = String(adresse || '').replace(/'/g, ' ');
    const chantierEsc = String(chantier || '').replace(/'/g, ' ');

    // Encoder les photos en base64 pour Python
    const photoAvantB64 = photo_avant ? photo_avant.replace(/^data:image\/[a-z]+;base64,/, '') : null;
    const photoApresB64 = photo_apres ? photo_apres.replace(/^data:image\/[a-z]+;base64,/, '') : null;

    const py = `# -*- coding: utf-8 -*-
import io, base64
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.platypus.flowables import HRFlowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.utils import ImageReader

W,H=A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
VERT=colors.HexColor('#16a34a'); GRIS=colors.HexColor('#555555')
GRIS_L=colors.HexColor('#f5f5f5'); LIGNE=colors.HexColor('#e0e0e0')
BLANC=colors.white

def p(txt,sz=9,font='Helvetica',color=colors.HexColor('#333333'),align=TA_LEFT,sb=4,sa=4):
    return Paragraph(str(txt).replace('\\\\n','<br/>'),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=sz*1.5,wordWrap='CJK'))

logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_bg()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1; self.saveState(); self._draw_bg()
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_bg(self):
        self.setFillColor(BLANC); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.6*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.6*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.68*cm,H-4.8*cm,W-0.68*cm,4.8*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.68*cm,H-4.8*cm,W-0.68*cm,0.1*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-4.5*cm,width=3.5*cm,height=3.5*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',16); self.setFillColor(BLANC)
        self.drawString(5.5*cm,H-1.6*cm,"RAPPORT D'INTERVENTION")
        self.setFont('Helvetica',9); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.5*cm,H-2.2*cm,'SINELEC Paris — Electricien professionnel')
        self.drawString(5.5*cm,H-2.7*cm,'128 Rue La Boetie, 75008 Paris — 07 87 38 86 22')
        self.drawString(5.5*cm,H-3.2*cm,'sinelec.paris@gmail.com — SIRET : 91015824500019')
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.8*cm,5.3*cm,1.3*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm,H-2.85*cm,'Ref : ${num}')
        self.drawCentredString(W-3.85*cm,H-3.3*cm,'Date : ${dateStr}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,0.9*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,0.9*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',7); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.38*cm,'SINELEC Paris \\u2022 128 Rue La Boetie 75008 Paris \\u2022 07 87 38 86 22 \\u2022 SIRET : 91015824500019 \\u2022 TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.22*cm,'${num}')
        self.restoreState()

doc=SimpleDocTemplate('${pdfPath}',pagesize=A4,leftMargin=1.3*cm,rightMargin=1.0*cm,topMargin=5.2*cm,bottomMargin=1.4*cm)
story=[]

# ── Fiche intervention ──
fiche=Table([
    [p('CLIENT',8,'Helvetica-Bold',OR,sa=2), p('${clientEsc}',10,'Helvetica-Bold',MARINE)],
    [p('ADRESSE',8,'Helvetica-Bold',OR,sa=2), p('${adresseEsc}',9,color=GRIS)],
    [p('OBJET',8,'Helvetica-Bold',OR,sa=2), p('${chantierEsc}',9,color=GRIS)],
    [p('DATE',8,'Helvetica-Bold',OR,sa=2), p('${dateStr}',9,color=GRIS)],
    [p('REF.',8,'Helvetica-Bold',OR,sa=2), p('${num}',9,color=GRIS)],
],colWidths=[3.0*cm,15.4*cm])
fiche.setStyle(TableStyle([
    ('BOX',(0,0),(-1,-1),0.5,OR),('INNERGRID',(0,0),(-1,-1),0.3,LIGNE),
    ('BACKGROUND',(0,0),(0,-1),colors.HexColor('#FBF7EC')),
    ('BACKGROUND',(1,0),(1,-1),BLANC),
    ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
    ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
    ('LINEBEFORE',(0,0),(0,-1),4,MARINE),
    ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
]))
story.append(fiche)
story.append(Spacer(1,0.4*cm))

# ── Titre section rapport ──
story.append(HRFlowable(width='100%',thickness=2,color=MARINE,spaceAfter=6))
story.append(p("COMPTE-RENDU DETAILLE DE L'INTERVENTION",10,'Helvetica-Bold',MARINE,sa=8))
story.append(HRFlowable(width='100%',thickness=0.5,color=OR,spaceAfter=12))

# ── Description longue ──
desc_txt = '${descEsc}'
for ligne in desc_txt.split('\\\\n'):
    if ligne.strip():
        story.append(p(ligne.strip(),9.5,sa=6))
story.append(Spacer(1,0.4*cm))

${photoAvantB64 || photoApresB64 ? `
# ── Photos avant / après ──
story.append(HRFlowable(width='100%',thickness=2,color=MARINE,spaceAfter=6))
story.append(p('PHOTOS AVANT / APRES',10,'Helvetica-Bold',MARINE,sa=8))
story.append(HRFlowable(width='100%',thickness=0.5,color=OR,spaceAfter=12))
photo_cells=[]
photo_labels=[]
${photoAvantB64 ? `
av_bytes=base64.b64decode('${photoAvantB64}')
av_img=Image(io.BytesIO(av_bytes),width=8.5*cm,height=6.0*cm)
av_img.hAlign='CENTER'
photo_cells.append(av_img)
photo_labels.append(p('AVANT INTERVENTION',8,'Helvetica-Bold',GRIS,TA_CENTER))
` : `photo_cells.append(p('')); photo_labels.append(p(''))`}
${photoApresB64 ? `
ap_bytes=base64.b64decode('${photoApresB64}')
ap_img=Image(io.BytesIO(ap_bytes),width=8.5*cm,height=6.0*cm)
ap_img.hAlign='CENTER'
photo_cells.append(ap_img)
photo_labels.append(p('APRES INTERVENTION',8,'Helvetica-Bold',VERT,TA_CENTER))
` : `photo_cells.append(p('')); photo_labels.append(p(''))`}
if len(photo_cells)==2:
    t_ph=Table([photo_cells,photo_labels],colWidths=[9.1*cm,9.1*cm])
    t_ph.setStyle(TableStyle([('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('BOX',(0,0),(-1,-1),0.5,LIGNE),('INNERGRID',(0,0),(-1,-1),0.3,LIGNE),
        ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.append(t_ph)
    story.append(Spacer(1,0.3*cm))
` : ''}

# ── Signature ──
story.append(Spacer(1,0.3*cm))
story.append(HRFlowable(width='100%',thickness=0.5,color=LIGNE,spaceAfter=10))
sig=Table([
    [p('Technicien SINELEC',8,'Helvetica-Bold',GRIS), p('Signature client',8,'Helvetica-Bold',GRIS,TA_RIGHT)],
    [p('Diahe SINERA',10,'Helvetica-Bold',MARINE), p('Nom : _______________________',9,align=TA_RIGHT)],
    [p('Electricien certifie — SINELEC Paris',8,color=GRIS), p('',8,align=TA_RIGHT)],
    [p('Garanti decennale ORUS N° 278499522',8,color=GRIS), p('',8,align=TA_RIGHT)],
],colWidths=[9.1*cm,9.1*cm])
sig.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
    ('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]))
story.append(sig)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('RAPPORT_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    try {
      execSync(`python3 ${pyPath} 2>&1`, { cwd: __dirname });
    } catch(pyErr) { throw new Error('PDF rapport: ' + pyErr.message.substring(0,200)); }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfB64Rapport = pdfBuffer.toString('base64');

    // Envoyer par email au client si email fourni
    if (email) {
      const prenom = (client || '').split(' ')[0];
      try {
        await envoyerEmail(email,
          `📋 SINELEC Paris — Rapport d'intervention ${num}`,
          `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;">
              <div style="font-size:36px;">📋</div>
              <h2 style="color:#fff;margin:8px 0 0;">Rapport d'intervention</h2>
              <p style="color:#BFC8D6;font-size:12px;margin-top:6px;">SINELEC Paris</p>
            </div>
            <div style="padding:24px;">
              <p style="color:#333;font-size:14px;">Bonjour <strong>${prenom}</strong>,</p>
              <p style="color:#555;font-size:13px;line-height:1.6;margin:12px 0;">
                Veuillez trouver ci-joint le rapport détaillé de l'intervention réalisée à votre domicile.<br>
                Ce document récapitule l'ensemble des travaux effectués et les vérifications réalisées.
              </p>
              <div style="background:#f9f9f9;border-left:4px solid #C9A84C;border-radius:4px;padding:12px 16px;margin:16px 0;">
                <div style="font-size:11px;font-weight:700;color:#C9A84C;text-transform:uppercase;margin-bottom:4px;">Référence</div>
                <div style="font-size:14px;font-weight:800;color:#1B2A4A;">${num} — ${dateStr}</div>
              </div>
              <p style="color:#999;font-size:12px;line-height:1.6;">
                Pour toute question : 📞 07 87 38 86 22<br>
                sinelec.paris@gmail.com
              </p>
            </div>
            <div style="background:#f8f8f8;padding:14px;text-align:center;">
              <p style="color:#999;font-size:11px;">SINELEC Paris • 128 Rue La Boétie, 75008 Paris</p>
            </div>
          </div></body></html>`,
          { content: pdfB64Rapport, name: `Rapport_SINELEC_${num}.pdf` }
        );
        console.log(`✅ Rapport envoyé à ${email}`);
      } catch(e) { console.error('Email rapport:', e.message); }
    }

    // Copie à SINELEC Paris
    try {
      await envoyerEmail('sinelec.paris@gmail.com',
        `📋 Rapport ${num} — ${client} — ${dateStr}`,
        `<p>Rapport généré pour <strong>${client}</strong> — ${adresse}</p><p>Ref: ${num}</p>`,
        { content: pdfB64Rapport, name: `Rapport_SINELEC_${num}.pdf` }
      );
    } catch(e) {}

    res.json({ success: true, num });

    // Nettoyage
    try { fs.unlinkSync(pyPath); fs.unlinkSync(pdfPath); } catch(e) {}
  } catch(e) {
    console.error('Rapport:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GÉNÉRATION RÉPONSE AVIS GOOGLE ────────────────
app.post('/api/avis/generer', authMiddleware, async (req, res) => {
  try {
    const { texte, etoiles, intervention } = req.body;
    if (!texte) return res.status(400).json({ error: 'Texte manquant' });

    const prompt = `Tu es l'assistant de SINELEC, électricien Paris (Diahe).
Génère une réponse professionnelle et chaleureuse à cet avis Google ${etoiles || 5} étoile(s).

AVIS : "${texte}"
${intervention ? `INTERVENTION : ${intervention}` : ''}

RÈGLES :
- 40 à 70 mots maximum
- Intègre 2-3 mots-clés SEO naturellement parmi : électricien Paris, dépannage électrique Paris, électricien Paris 8e, urgence électrique Paris, mise aux normes NF C 15-100, électricien Île-de-France
- ${(etoiles || 5) >= 4 ? 'Remercie sincèrement, valorise le point positif, invite à revenir' : 'Réponds calmement, propose de résoudre, reste professionnel'}
- Termine par : Diahe — SINELEC ⚡
- Donne UNIQUEMENT la réponse, sans introduction ni guillemets`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const reponse = response.content[0]?.text?.trim();
    res.json({ success: true, reponse });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATUT IA ──────────────────────────────────────
app.get('/api/ia/statut', authMiddleware, async (req, res) => {
  try {
    const { data: corrections } = await supabase
      .from('ia_corrections')
      .select('*')
      .order('date', { ascending: false })
      .limit(10);

    res.json({
      erreurs_en_cours: errorLog.length,
      dernieres_erreurs: errorLog.slice(0, 5),
      corrections: corrections || [],
      ia_active: true
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CRON SURVEILLANCE — toutes les heures ──────────
cron.schedule('0 * * * *', analyserEtCorrigerErreurs);

// ═══════════════════════════════════════════════════
// CALENDRIER CLIENT — PRISE DE RDV
// ═══════════════════════════════════════════════════

function dureeEstimee(prestations) {
  const noms = (prestations || []).map(p => (p.nom || p.designation || '').toLowerCase()).join(' ');
  if (noms.includes('tableau') || noms.includes('renovation') || noms.includes('mise aux normes')) return 3;
  if (noms.includes('vmc') || noms.includes('chauffe-eau') || noms.includes('borne')) return 2;
  return 1;
}

// Page calendrier client
app.get('/rdv/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data: devis } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!devis) return res.status(404).send(`<html><body style="font-family:Arial;text-align:center;padding:40px;"><h2>Lien invalide</h2><p>Contactez SINELEC Paris : 07 87 38 86 22</p></body></html>`);
    if (devis.date_intervention) {
      const d = new Date(devis.date_intervention).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      return res.send(`<html><body style="font-family:Arial;text-align:center;padding:40px;background:#f5f5f7;"><div style="max-width:400px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.1);"><div style="font-size:48px;margin-bottom:16px;">✅</div><h2 style="color:#1B2A4A;">RDV déjà planifié</h2><p style="color:#777;font-size:14px;margin-top:8px;">Votre intervention est prévue le<br><strong style="color:#1B2A4A;font-size:16px;">${d}</strong></p><p style="color:#999;font-size:12px;margin-top:20px;">SINELEC Paris — 07 87 38 86 22</p></div></body></html>`);
    }
    const duree = dureeEstimee(devis.prestations);
    const prestDesc = (devis.prestations || []).slice(0,2).map(p => p.nom || p.designation || '').join(', ');
    const montantStr = parseFloat(devis.total_ht || 0).toLocaleString('fr-FR',{minimumFractionDigits:2}) + ' €';

    res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SINELEC Paris — Prendre RDV</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#f5f5f7;min-height:100vh;}
.hd{background:linear-gradient(135deg,#1B2A4A,#243660);padding:20px 24px;text-align:center;}
.hd-logo{font-size:30px;margin-bottom:4px;}.hd-title{font-size:18px;font-weight:900;color:#fff;}.hd-sub{font-size:11px;color:#BFC8D6;margin-top:4px;}
.dc{background:#fff;margin:14px;border-radius:14px;padding:14px 18px;box-shadow:0 2px 12px rgba(0,0,0,0.08);border-left:4px solid #C9A84C;}
.dl{font-size:9px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;}
.dn{font-size:15px;font-weight:800;color:#1B2A4A;}.dd{font-size:11px;color:#777;margin-top:2px;}.dm{font-size:18px;font-weight:900;color:#1B2A4A;margin-top:5px;}
.st{font-size:11px;font-weight:800;color:#1B2A4A;text-transform:uppercase;letter-spacing:1px;margin:0 14px 8px;}
.wn{display:flex;align-items:center;justify-content:space-between;margin:0 14px 10px;}
.wb{background:#fff;border:1px solid #e5e5e5;border-radius:8px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;font-family:inherit;}
.wl{font-size:12px;font-weight:800;color:#1B2A4A;}
.dg{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:0 14px 8px;}
.db{background:#fff;border:1.5px solid #e5e5e5;border-radius:10px;padding:8px 3px;text-align:center;cursor:pointer;transition:all 0.2s;}
.db.hs{border-color:#C9A84C;}.db.ns{opacity:0.3;cursor:not-allowed;}.db.sl{background:#1B2A4A;border-color:#1B2A4A;}
.dn2{font-size:9px;font-weight:700;color:#999;text-transform:uppercase;}.dn3{font-size:15px;font-weight:900;color:#1B2A4A;margin:2px 0;}
.dots{display:flex;justify-content:center;gap:2px;}.dot{width:4px;height:4px;border-radius:50%;background:#C9A84C;}
.db.sl .dn2,.db.sl .dn3{color:#fff;}.db.sl .dot{background:rgba(255,255,255,0.5);}
.lg{display:flex;gap:12px;margin:0 14px 10px;}
.li{display:flex;align-items:center;gap:4px;font-size:10px;color:#777;font-weight:600;}
.ld{width:10px;height:10px;border-radius:3px;}
.ss{margin:0 14px 14px;display:none;}
.st2{font-size:12px;font-weight:800;color:#1B2A4A;margin-bottom:8px;}
.sg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;}
.sl2{background:#fff;border:1.5px solid #e5e5e5;border-radius:11px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.2s;}
.sl2.av:hover{border-color:#C9A84C;background:#fffbf0;}.sl2.se{background:#1B2A4A;border-color:#1B2A4A;}
.sl2.bz{background:#f8f8f8;cursor:not-allowed;}
.st3{font-size:15px;font-weight:800;color:#1B2A4A;}.sd{font-size:9px;color:#999;margin-top:1px;}
.sl2.se .st3,.sl2.se .sd{color:#fff;}.sl2.bz .st3{font-size:10px;color:#ccc;font-weight:600;}
.rp{background:#f0f7f0;border:1.5px solid rgba(22,163,74,0.25);border-radius:10px;padding:11px 14px;margin:0 14px 12px;display:none;align-items:center;gap:10px;}
.rt{font-size:12px;font-weight:700;color:#15803d;}.rs{font-size:10px;color:#16a34a;margin-top:2px;}
.cb{width:calc(100% - 28px);margin:0 14px 12px;background:linear-gradient(135deg,#C9A84C,#daa520);color:#fff;border:none;border-radius:12px;padding:15px;font-size:14px;font-weight:900;cursor:pointer;font-family:inherit;display:block;opacity:0.3;pointer-events:none;letter-spacing:0.5px;}
.cb.ac{opacity:1;pointer-events:all;}
.nt{margin:0 14px 28px;font-size:10px;color:#999;text-align:center;line-height:1.6;}
.ok{display:none;text-align:center;padding:40px 20px;}
.ok-i{font-size:52px;margin-bottom:14px;}.ok h2{color:#1B2A4A;font-size:18px;margin-bottom:8px;}.ok p{color:#777;font-size:13px;line-height:1.6;}
</style></head><body>
<div class="hd"><div class="hd-logo">⚡</div><div class="hd-title">SINELEC Paris</div><div class="hd-sub">Électricien Paris & Île-de-France • 7j/7</div></div>
<div style="height:14px;"></div>
<div class="dc"><div class="dl">📋 Devis signé — ${num}</div><div class="dn">${devis.client||''}</div><div class="dd">${prestDesc}</div><div class="dm">${montantStr}</div></div>
<div id="mc">
  <div class="st">Choisissez votre date</div>
  <div class="wn"><button class="wb" onclick="chg(-1)">‹</button><span class="wl" id="wl">...</span><button class="wb" onclick="chg(1)">›</button></div>
  <div class="dg" id="dg"></div>
  <div class="lg">
    <div class="li"><div class="ld" style="background:#C9A84C;"></div>Disponible</div>
    <div class="li"><div class="ld" style="background:#e5e5e5;"></div>Complet</div>
  </div>
  <div class="ss" id="ss"><div class="st2" id="st2"></div><div class="sg" id="sg"></div></div>
  <div class="rp" id="rp"><div style="font-size:20px;">✅</div><div><div class="rt" id="rt"></div><div class="rs">~${duree}h • En attente de confirmation</div></div></div>
  <button class="cb" id="cb" onclick="confirmer()">Confirmer ce créneau →</button>
  <div class="nt">⚡ Soumis à validation SINELEC Paris<br>SMS de confirmation dans les 2h • <strong>07 87 38 86 22</strong></div>
</div>
<div class="ok" id="ok">
  <div class="ok-i">🎉</div><h2>Demande envoyée !</h2>
  <p>Votre demande a été transmise à SINELEC Paris.<br>Vous recevrez un email de confirmation dans les 2h.</p>
  <p style="margin-top:16px;font-weight:800;color:#1B2A4A;font-size:14px;" id="od"></p>
  <p style="margin-top:14px;color:#999;font-size:11px;">SINELEC Paris — 07 87 38 86 22</p>
</div>
<script>
const NUM='${num}',DUR=${duree};
const HD=8,HF=20;
let off=0,jour=null,cren=null,occ=[];
async function init(){
  try{const r=await fetch('/api/rdv/disponibilites?num='+NUM);const d=await r.json();occ=d.occupe||[];}catch(e){occ=[];}
  rend();
}
function lundi(o){const d=new Date();d.setHours(0,0,0,0);const j=d.getDay()||7;d.setDate(d.getDate()-j+1+o*7);return d;}
function fmt(d){return d.toISOString().split('T')[0];}
function pris(ds,h){return occ.some(o=>o.date===ds&&o.heure===h);}
function libres(ds){const s=[];for(let h=HD;h<=HF-DUR;h++){if(!pris(ds,h+':00'))s.push(h);}return s;}
function chg(d){off+=d;jour=null;cren=null;document.getElementById('ss').style.display='none';document.getElementById('rp').style.display='none';document.getElementById('cb').classList.remove('ac');rend();}
function rend(){
  const l=lundi(off);const js=['Lun','Mar','Mer','Jeu','Ven','Sam'];
  const ms=['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const fin=new Date(l);fin.setDate(fin.getDate()+5);
  document.getElementById('wl').textContent=l.getDate()+' '+ms[l.getMonth()]+' — '+fin.getDate()+' '+ms[fin.getMonth()]+' '+l.getFullYear();
  const g=document.getElementById('dg');g.innerHTML='';
  const t=new Date();t.setHours(0,0,0,0);
  for(let i=0;i<6;i++){
    const d=new Date(l);d.setDate(l.getDate()+i);
    const ds=fmt(d);const past=d<t;
    const sl=past?[]:libres(ds);const hs=sl.length>0;
    const b=document.createElement('div');
    b.className='db'+(hs?' hs':'  ns')+(jour===ds?' sl':'');
    b.innerHTML='<div class="dn2">'+js[i]+'</div><div class="dn3">'+d.getDate()+'</div><div class="dots">'+sl.slice(0,3).map(()=>'<div class="dot"></div>').join('')+'</div>';
    if(hs)b.onclick=()=>selJour(ds,d,sl);
    g.appendChild(b);
  }
}
function selJour(ds,do2,sl){
  jour=ds;cren=null;
  document.getElementById('rp').style.display='none';
  document.getElementById('cb').classList.remove('ac');
  rend();
  const jn=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const mn=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  document.getElementById('st2').textContent=jn[do2.getDay()]+' '+do2.getDate()+' '+mn[do2.getMonth()];
  document.getElementById('ss').style.display='block';
  const g=document.getElementById('sg');g.innerHTML='';
  for(let h=HD;h<=HF-DUR;h++){
    const libre=!pris(ds,h+':00');
    const d=document.createElement('div');
    d.className='sl2 '+(libre?'av':'bz');
    d.innerHTML=libre?'<div class="st3">'+h+'h00</div><div class="sd">~'+DUR+'h</div>':'<div class="st3">Non dispo</div><div class="sd"></div>';
    if(libre)d.onclick=()=>selCren(h,d,do2);
    g.appendChild(d);
  }
  document.getElementById('ss').scrollIntoView({behavior:'smooth',block:'start'});
}
function selCren(h,el,do2){
  document.querySelectorAll('.sl2').forEach(s=>s.classList.remove('se'));
  el.classList.add('se');cren=h;
  const jn=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const mn=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const lb=jn[do2.getDay()]+' '+do2.getDate()+' '+mn[do2.getMonth()]+' à '+h+'h00';
  document.getElementById('rt').textContent=lb;
  document.getElementById('rp').style.display='flex';
  document.getElementById('cb').classList.add('ac');
  document.getElementById('rp').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function confirmer(){
  if(!jour||cren===null)return;
  const btn=document.getElementById('cb');
  btn.textContent='⏳ Envoi...';btn.classList.remove('ac');
  try{
    const r=await fetch('/api/rdv/demande',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:NUM,date:jour,heure:cren+':00'})});
    const d=await r.json();
    if(d.success){
      document.getElementById('mc').style.display='none';
      document.getElementById('ok').style.display='block';
      document.getElementById('od').textContent=document.getElementById('rt').textContent;
    } else { alert('Erreur : '+(d.error||'Réessayez'));btn.classList.add('ac');btn.textContent='Confirmer ce créneau →'; }
  }catch(e){alert('Erreur réseau');btn.classList.add('ac');btn.textContent='Confirmer ce créneau →';}
}
init();
</script></body></html>`);
  } catch(e) { res.status(500).send('Erreur: ' + e.message); }
});

// Disponibilités — renvoie les créneaux occupés
app.get('/api/rdv/disponibilites', async (req, res) => {
  try {
    const { data: agenda } = await supabase.from('agenda').select('date_intervention,heure').not('statut','in','("terminé","annulé")');
    const occupe = (agenda||[]).filter(a=>a.date_intervention&&a.heure).map(a=>({date:a.date_intervention,heure:a.heure}));
    res.json({ occupe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Demande RDV → email SINELEC Paris avec boutons Confirmer/Refuser
app.post('/api/rdv/demande', async (req, res) => {
  try {
    const { num, date, heure } = req.body;
    const { data: devis } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!devis) return res.status(404).json({ error: 'Devis introuvable' });

    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const dateFormate = new Date(date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const lienOui = `${appUrl}/api/rdv/confirmer?num=${num}&date=${date}&heure=${encodeURIComponent(heure)}&action=oui`;
    const lienNon = `${appUrl}/api/rdv/confirmer?num=${num}&date=${date}&heure=${encodeURIComponent(heure)}&action=non`;

    await supabase.from('historique').update({ rdv_statut: 'en_attente' }).eq('num', num);

    await envoyerEmail('sinelec.paris@gmail.com',
      `📅 Demande RDV — ${devis.client} — Action requise`,
      `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;">
      <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:24px;text-align:center;">
          <div style="font-size:32px;">📅</div>
          <h2 style="color:#fff;margin:8px 0 0;font-size:18px;">Nouvelle demande de RDV</h2>
        </div>
        <div style="padding:24px;">
          <p style="font-size:14px;color:#333;margin-bottom:14px;"><strong>${devis.client}</strong> — Devis <strong>${num}</strong> (${parseFloat(devis.total_ht||0).toFixed(0)}€)</p>
          <div style="background:#fffbf0;border:1.5px solid #C9A84C;border-radius:12px;padding:16px;margin-bottom:16px;text-align:center;">
            <div style="font-size:11px;font-weight:800;color:#C9A84C;text-transform:uppercase;margin-bottom:6px;">📅 Date souhaitée</div>
            <div style="font-size:20px;font-weight:900;color:#1B2A4A;">${dateFormate}</div>
            <div style="font-size:16px;font-weight:700;color:#555;margin-top:4px;">à ${heure.replace(':00','')}h00</div>
          </div>
          <p style="font-size:13px;color:#777;margin-bottom:6px;">📍 ${devis.adresse||'—'}</p>
          <p style="font-size:13px;color:#777;margin-bottom:20px;">📞 ${devis.telephone||'—'}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <a href="${lienOui}" style="background:#16a34a;color:#fff;text-decoration:none;border-radius:10px;padding:14px;text-align:center;font-size:15px;font-weight:800;display:block;">✅ Confirmer</a>
            <a href="${lienNon}" style="background:#fee2e2;color:#dc2626;text-decoration:none;border-radius:10px;padding:14px;text-align:center;font-size:15px;font-weight:800;display:block;">❌ Refuser</a>
          </div>
        </div>
        <div style="background:#f8f8f8;padding:12px;text-align:center;">
          <p style="color:#999;font-size:11px;">SINELEC Paris • 07 87 38 86 22 • sinelec.paris@gmail.com</p>
        </div>
      </div></body></html>`
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Confirmation ou refus depuis l'email
app.get('/api/rdv/confirmer', async (req, res) => {
  try {
    const { num, date, heure, action } = req.query;
    const { data: devis } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!devis) return res.send('<h2>Lien invalide</h2>');

    const prenom = (devis.client || '').split(' ')[0];
    const dateFormate = new Date(date).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

    if (action === 'oui') {
      // Ajouter dans l'agenda
      await supabase.from('agenda').insert({
        client: devis.client, telephone: devis.telephone, adresse: devis.adresse,
        date_intervention: date, heure, statut: 'planifié',
        type_intervention: (devis.prestations||[]).slice(0,1).map(p=>p.nom||p.designation).join('') || 'Intervention',
        notes: `Devis ${num} — ${parseFloat(devis.total_ht||0).toFixed(0)}€`
      });
      // Mettre à jour l'historique
      await supabase.from('historique').update({ date_intervention: date, rdv_heure: heure, rdv_statut: 'confirme' }).eq('num', num);

      // Email de confirmation au client
      if (devis.email) {
        await envoyerEmail(devis.email,
          `✅ SINELEC Paris — RDV confirmé !`,
          `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;">
          <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;">
            <div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;">
              <div style="font-size:40px;">✅</div>
              <h2 style="color:#fff;margin:8px 0 0;">RDV Confirmé !</h2>
            </div>
            <div style="padding:28px;">
              <p style="font-size:15px;color:#333;margin-bottom:16px;">Bonjour <strong>${prenom}</strong>,</p>
              <div style="background:#f0f7f0;border:1.5px solid rgba(22,163,74,0.3);border-radius:12px;padding:18px;text-align:center;margin-bottom:16px;">
                <div style="font-size:11px;font-weight:800;color:#16a34a;text-transform:uppercase;margin-bottom:6px;">📅 Votre RDV</div>
                <div style="font-size:20px;font-weight:900;color:#1B2A4A;">${dateFormate}</div>
                <div style="font-size:16px;font-weight:700;color:#555;margin-top:4px;">à ${heure.replace(':00','')}h00</div>
              </div>
              <p style="font-size:13px;color:#777;line-height:1.6;">📍 ${devis.adresse||''}<br>📞 En cas d'urgence : <strong>07 87 38 86 22</strong></p>
            </div>
            <div style="background:#f8f8f8;padding:14px;text-align:center;">
              <p style="color:#999;font-size:11px;">SINELEC Paris • sinelec.paris@gmail.com</p>
            </div>
          </div></body></html>`
        ).catch(()=>{});
      }

      res.send(`<html><body style="font-family:Arial;text-align:center;padding:40px;background:#f5f5f7;"><div style="max-width:400px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.1);"><div style="font-size:48px;">✅</div><h2 style="color:#1B2A4A;margin:12px 0 8px;">RDV Confirmé !</h2><p style="color:#777;">${dateFormate} à ${heure.replace(':00','')}h00</p><p style="color:#777;margin-top:8px;">Email de confirmation envoyé à ${devis.client}.</p><p style="color:#999;font-size:11px;margin-top:20px;">SINELEC Paris</p></div></body></html>`);

    } else {
      // Refus → email au client pour rechoisir
      await supabase.from('historique').update({ rdv_statut: 'refuse' }).eq('num', num);
      const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
      if (devis.email) {
        await envoyerEmail(devis.email,
          `📅 SINELEC Paris — Choisissez un autre créneau`,
          `<html><body style="font-family:Arial;padding:0;background:#f5f5f7;"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;"><div style="background:linear-gradient(135deg,#1B2A4A,#243660);padding:28px;text-align:center;"><div style="font-size:36px;">⚡</div><h2 style="color:#fff;margin:8px 0 0;">SINELEC Paris</h2></div><div style="padding:28px;"><p style="font-size:14px;color:#333;margin-bottom:16px;">Bonjour <strong>${prenom}</strong>,</p><p style="font-size:14px;color:#555;margin-bottom:20px;">Le créneau demandé (${dateFormate} à ${heure.replace(':00','')}h00) n'est malheureusement plus disponible. Veuillez choisir un autre créneau :</p><div style="text-align:center;"><a href="${appUrl}/rdv/${num}" style="background:linear-gradient(135deg,#C9A84C,#daa520);color:#fff;text-decoration:none;border-radius:14px;padding:14px 28px;font-size:14px;font-weight:800;display:inline-block;">📅 Choisir un autre créneau</a></div></div><div style="background:#f8f8f8;padding:14px;text-align:center;"><p style="color:#999;font-size:11px;">SINELEC Paris • 07 87 38 86 22</p></div></div></body></html>`
        ).catch(()=>{});
      }
      res.send(`<html><body style="font-family:Arial;text-align:center;padding:40px;background:#f5f5f7;"><div style="max-width:400px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.1);"><div style="font-size:48px;">📅</div><h2 style="color:#1B2A4A;margin:12px 0 8px;">Créneau refusé</h2><p style="color:#777;">Email envoyé à ${devis.client} pour rechoisir un créneau.</p></div></body></html>`);
    }
  } catch(e) { res.status(500).send('Erreur: ' + e.message); }
});

// ═══════════════════════════════════════════════════
// DÉMARRAGE
// ═══════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  console.log(`⚡ SINELEC OS v${CONFIG.meta.version} — Port ${PORT}`);
});

server.timeout = 300000;
server.keepAliveTimeout = 300000;
