require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JAUNE = '#F5A623';
const NOIR = '#111111';
const GRIS_DARK = '#444444';
const GRIS_MED = '#888888';
const GRIS_LIGHT = '#F5F5F5';
const GRIS_LINE = '#E5E5E5';
const GRIS_BG = '#FAFAFA';

// ── DÉTAILS FIXES PAR PRESTATION ─────────────────────────────────────────
const DETAILS = {
  'Déplacement Paris': 'Déplacement du technicien SINELEC Paris en zone intra-muros (75). Véhicule professionnel équipé, outillage complet, disponibilité immédiate. Inclus dans le forfait intervention.',
  'Déplacement banlieue <20km': 'Déplacement du technicien SINELEC en proche banlieue (92, 93, 94) dans un rayon de 20 km. Véhicule professionnel équipé, prise en charge rapide.',
  'Déplacement >20km (78/91/95)': 'Déplacement longue distance en grande couronne (78, 91, 95) au-delà de 20 km. Véhicule professionnel équipé, intervention planifiée.',
  'MO / heure supplémentaire': 'Main d\'oeuvre technicien qualifié SINELEC Paris, heure supplémentaire au-delà du forfait. Travaux réalisés dans les règles de l\'art, conformément à la norme NF C 15-100.',
  'Urgence jour': 'Intervention urgente en journée (8h-18h). Déplacement prioritaire, technicien disponible immédiatement. Diagnostic et intervention sur place. Forfait tout compris, sans surprise.',
  'Urgence soir (18h-22h)': 'Intervention urgente en soirée (18h-22h). Astreinte activée, technicien dépêché en priorité. Diagnostic et remise en service le soir même. Disponibilité 7j/7.',
  'Urgence nuit / WE / férié': 'Intervention urgente de nuit (22h-8h), week-end ou jour férié. Service 24h/24, 7j/7. Technicien disponible immédiatement. Forfait astreinte nuit inclus.',
  'Prise standard': 'Fourniture et pose d\'une prise de courant 2P+T 16A standard. Comprend : dépose de l\'ancienne prise si existante, fourniture prise appareillage professionnel, pose et raccordement, test de fonctionnement et vérification conformité NF C 15-100.',
  'Prise cuisinière 32A': 'Fourniture et pose d\'une prise spécialisée 32A 2P+T pour cuisinière ou plaque de cuisson. Comprend : dépose ancienne installation, fourniture prise 32A professionnelle, raccordement sur circuit dédié 6mm², test et mise en service NF C 15-100.',
  'Prise étanche IP44': 'Fourniture et pose d\'une prise étanche IP44 pour usage extérieur ou pièce humide. Comprend : dépose existante, fourniture prise étanche professionnelle, pose, raccordement, test d\'étanchéité et vérification conformité.',
  'Prise RJ45': 'Fourniture et pose d\'une prise réseau RJ45 catégorie 6. Comprend : dépose existante si nécessaire, fourniture prise RJ45 pro, câblage, raccordement, test de continuité et vérification signal.',
  'Interrupteur simple': 'Fourniture et pose d\'un interrupteur simple allumage. Comprend : dépose ancienne pièce, fourniture interrupteur appareillage professionnel, pose, raccordement, test fonctionnel et vérification conformité NF C 15-100.',
  'Interrupteur va-et-vient': 'Fourniture et pose d\'un interrupteur va-et-vient. Comprend : dépose existant, fourniture 2 interrupteurs va-et-vient assortis, raccordement filerie, test de fonctionnement dans les deux sens, vérification conformité.',
  'Variateur / connecté': 'Fourniture et pose d\'un variateur d\'éclairage ou interrupteur connecté. Comprend : dépose existant, fourniture variateur/module connecté professionnel, raccordement, paramétrage, test et mise en service.',
  'Luminaire simple': 'Fourniture et pose d\'un luminaire (plafonnier ou applique). Comprend : dépose de l\'ancien appareil, fourniture support DCL, raccordement sur boîte de dérivation, pose luminaire, test d\'éclairage et vérification conformité NF C 15-100.',
  'Lustre lourd': 'Fourniture et pose d\'un lustre ou luminaire lourd (>5kg). Comprend : dépose existant, installation crochet de charge renforcé, fourniture rosace DCL renforcée, raccordement, test et mise en service. Fixation adaptée à la charge.',
  'Spot encastré': 'Fourniture et pose d\'un spot encastré LED ou halogène. Comprend : perçage ou découpe du support, câblage depuis boîte de dérivation, fourniture spot encastré professionnel, raccordement, test d\'allumage et vérification thermique.',
  'Bandeau LED (ml)': 'Fourniture et pose de bandeau LED (prix au mètre linéaire). Comprend : support aluminium, bandeau LED professionnel, alimentation dédiée, raccordement, test lumineux et colorimétrique.',
  'Point lumineux DCL': 'Création d\'un point lumineux avec DCL (Dispositif de Connexion pour Luminaire). Comprend : tirage câble depuis tableau ou dérivation existante, pose boîte d\'encastrement, installation DCL, raccordement et test.',
  'Éclairage extérieur': 'Fourniture et pose d\'un point d\'éclairage extérieur. Comprend : câblage étanche, support IP65 minimum, raccordement sur circuit dédié ou existant, mise à la terre, test d\'étanchéité et vérification conformité.',
  'Disjoncteur standard': 'Fourniture et remplacement d\'un disjoncteur magnétothermique standard. Comprend : mise hors tension sécurisée, dépose disjoncteur défectueux, fourniture disjoncteur neuf calibre adapté (marque Schneider/Legrand/Hager), raccordement sur peigne d\'alimentation, test de déclenchement et remise sous tension. Conforme NF C 15-100. Garantie décennale ORUS.',
  'Disjoncteur différentiel 30mA': 'Fourniture et remplacement d\'un disjoncteur différentiel 30mA type AC. Comprend : mise hors tension, dépose existant, fourniture disjoncteur différentiel 30mA neuf (marque Schneider/Legrand/Hager), câblage et raccordement, test de déclenchement différentiel, vérification sélectivité. Conforme NF C 15-100. Garantie ORUS.',
  'Inter. différentiel 63A type A': 'Fourniture et remplacement d\'un interrupteur différentiel 63A type A 30mA. Comprend : mise hors tension totale, dépose ancien appareil, fourniture interrupteur différentiel 63A type A neuf (détection défauts AC et pulsés), raccordement, DLCU, test de déclenchement, remise sous tension progressive. Conforme NF C 15-100. Garantie ORUS.',
  'Parafoudre': 'Fourniture et pose d\'un parafoudre de type 2. Comprend : vérification compatibilité tableau, fourniture parafoudre normalisé, raccordement sur rail DIN, câblage avec conducteur de protection, test et vérification conformité NF C 15-100. Protection installation contre surtensions.',
  'Mini tableau NF C 15-100': 'Fourniture et pose d\'un mini tableau de distribution conforme NF C 15-100. Comprend : dépose ancien tableau, fourniture coffret encastrable ou saillie, installation disjoncteur général différentiel, disjoncteurs par circuit, peigne d\'alimentation, barre de terre, étiquetage circuits. Garantie décennale ORUS.',
  'Tableau complet 1 rangée': 'Remplacement complet du tableau électrique 1 rangée (13 modules). Comprend : dépose ancien tableau, fourniture coffret Legrand/Schneider/Hager encastrable, interrupteur différentiel 63A type A 30mA, disjoncteurs magnétothermiques calibrés par circuit, peigne d\'alimentation, DLCU (dispositif de liaison au conducteur unique), barre de terre cuivre, câblage soigné, étiquetage de chaque circuit, test complet installation, mise en service. Conforme NF C 15-100. Garantie décennale ORUS.',
  'Tableau complet 2 rangées': 'Remplacement complet du tableau électrique 2 rangées (26 modules). Comprend : dépose complet ancien tableau, fourniture coffret 2 rangées Legrand/Schneider/Hager, 2 interrupteurs différentiels 63A type A 30mA, disjoncteurs magnétothermiques calibrés, peignes d\'alimentation double rangée, DLCU, barre de terre cuivre, câblage soigné avec repérage, étiquetage circuits, test complet, mise en service. Conforme NF C 15-100. Garantie décennale ORUS.',
  'Tableau complet 3 rangées': 'Remplacement complet du tableau électrique 3 rangées (39 modules). Comprend : dépose complet, fourniture coffret 3 rangées Legrand/Schneider/Hager, disjoncteur général, interrupteurs différentiels 63A type A par départ, disjoncteurs calibrés tous circuits, peignes, DLCU, barre de terre, câblage soigné, étiquetage complet, test et réception. Conforme NF C 15-100. Garantie décennale ORUS.',
  'Recherche de panne': 'Diagnostic et recherche de panne électrique. Comprend : analyse des symptômes, test par circuit avec appareillage professionnel (multimètre, testeur de boucle, caméra thermique si nécessaire), identification précise de l\'origine, rapport verbal du diagnostic au client. Prix hors réparation.',
  'Réparation court-circuit': 'Localisation et réparation d\'un court-circuit. Comprend : mise hors tension, recherche par secteur, identification du défaut d\'isolement ou de câblage, remplacement câble ou section défectueuse, test d\'isolement, remise sous tension progressive et vérification.',
  'Réactivation coupure': 'Réactivation après coupure ou disjonction générale. Comprend : diagnostic cause de coupure, vérification état installation, identification circuit défaillant, remise en sécurité, réarmement progressif par circuit, test fonctionnel complet avant remise sous tension.',
  'Diagnostic complet': 'Diagnostic complet de l\'installation électrique. Comprend : contrôle visuel tableau et circuits, mesure résistance de terre, test différentiels, vérification continuité de protection, contrôle tensions, rapport détaillé des anomalies constatées et recommandations travaux.',
  'Recherche fuite de courant': 'Recherche de fuite de courant ou défaut d\'isolement. Comprend : test par circuits avec pince ampèremétrique, mesure d\'isolement câble par câble, identification précise de la source de fuite, rapport et recommandation de réparation.',
  'Mise à la terre complète': 'Réalisation d\'une mise à la terre complète de l\'installation. Comprend : pose piquet de terre (longueur adaptée résistivité sol), câble cuivre 16mm² jusqu\'au tableau, raccordement barre de terre, mesure résistance (objectif <100Ω), liaison équipotentielle principale. Conforme NF C 15-100.',
  'Liaison équipotentielle princ.': 'Réalisation de la liaison équipotentielle principale. Comprend : pose conducteur cuivre 6mm² ou 10mm², raccordement masses métalliques (canalisations eau, gaz, chauffage), connexion barre de terre tableau, test de continuité. Obligatoire NF C 15-100.',
  'Liaison équipotentielle SDB': 'Réalisation de la liaison équipotentielle supplémentaire en salle de bain. Comprend : pose conducteur 2.5mm² vert/jaune, raccordement toutes masses métalliques (baignoire, robinetterie, radiateur, boîtier douche), connexion terre, test de continuité. Obligatoire zone 0-1-2 NF C 15-100.',
  'Détecteur fumée DAAF': 'Fourniture et pose d\'un détecteur avertisseur autonome de fumée (DAAF). Comprend : fourniture DAAF normalisé NF EN 14604, fixation au plafond, test de déclenchement, notice remise au client. Conforme loi du 9 mars 2010.',
  'Diagnostic électrique': 'Réalisation d\'un diagnostic électrique complet de l\'installation. Comprend : contrôle 87 points de vérification selon NF C 16-600, mesures électriques (terre, isolement, DDR), rapport écrit avec anomalies classées A1/A2/A3, remise rapport signé.',
  'Circuit apparent 5m': 'Création d\'un circuit électrique apparent sur 5 mètres. Comprend : tirage câble H07V-U en goulotte ou moulure, pose boîte de dérivation, raccordement tableau sur disjoncteur dédié, test isolement, mise en service. Câble et goulotte fournis.',
  'Circuit encastré 5m': 'Création d\'un circuit électrique encastré sur 5 mètres. Comprend : saignée dans cloison ou passage sous conduit, tirage câble H07V-U ou ICT, rebouchage, pose boîte d\'encastrement, raccordement tableau, test, mise en service. Câble fourni.',
  'Câble supplémentaire (ml)': 'Tirage de câble électrique supplémentaire, prix au mètre linéaire. Câble H07V-U 1.5 à 6mm² selon circuit. Comprend fourniture câble, tirage dans goulotte ou encastré, raccordements aux extrémités.',
  'Goulotte/moulure (ml)': 'Fourniture et pose de goulotte ou moulure PVC, prix au mètre linéaire. Comprend : fourniture goulotte professionnelle, découpe, fixation, accessoires angles et jonctions.',
  'Passage câble cloison/dalle': 'Passage de câble à travers cloison, mur ou dalle. Comprend : perçage avec foret adapté, fourniture et pose fourreau de protection, passage câble, calfeutrement coupe-feu si nécessaire.',
  'Interphone audio': 'Fourniture et pose d\'un interphone audio 2 fils. Comprend : dépose existant, fourniture interphone audio professionnel (platine ext. + combiné int.), câblage, raccordement, réglage sensibilité, test complet appel et ouverture porte.',
  'Visiophone': 'Fourniture et pose d\'un visiophone couleur. Comprend : dépose existant, fourniture visiophone couleur écran 7\' professionnel (platine ext. + moniteur int.), câblage 2 fils ou IP, raccordement, paramétrage, test appel vidéo et ouverture porte.',
  'Chauffe-eau électrique': 'Raccordement électrique d\'un chauffe-eau. Comprend : fourniture et pose prise spécialisée 20A ou raccordement direct, circuit dédié depuis tableau, disjoncteur 20A, câble 2.5mm², test de fonctionnement et vérification conformité.',
  'Borne Green Up': 'Fourniture et pose d\'une prise Green Up pour recharge véhicule électrique. Comprend : fourniture prise Green Up 3.7kW, circuit dédié depuis tableau, disjoncteur différentiel 16A type A, câble 2.5mm², test de charge. Conforme UTE C 15-722.',
  'Borne IRVE 7kW': 'Fourniture et installation d\'une borne de recharge IRVE 7kW mode 3. Comprend : fourniture borne wallbox 7kW avec câble T2, circuit dédié 32A, câble 6mm², disjoncteur différentiel 40A type A, mise en service, attestation IRVE. Conforme UTE C 15-722 et décret IRVE.',
  'Détecteur de mouvement': 'Fourniture et pose d\'un détecteur de mouvement infrarouge. Comprend : fourniture détecteur 180° ou 360°, câblage sur circuit éclairage existant ou dédié, réglage sensibilité et temporisation, test de déclenchement.',
  'VMC simple flux': 'Fourniture et pose d\'une VMC simple flux autoréglable. Comprend : dépose ancienne VMC si existante, fourniture centrale VMC NF, pose en combles ou local technique, raccordement gaines souples, pose bouches d\'extraction, circuit électrique dédié 2A, test débit et mise en service. Conforme DTU 68.3.',
  'Radiateur à inertie': 'Fourniture et pose d\'un radiateur électrique à inertie. Comprend : dépose existant si nécessaire, fourniture radiateur inertie (pierre ou fluide) avec thermostat programmable intégré, circuit dédié depuis tableau, disjoncteur calibré, raccordement, test et mise en service.',
};

function getDetail(designation) {
  return DETAILS[designation] || designation;
}

function genererPDFBuffer(data, type = 'devis') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const buffers = [];
    doc.on('data', d => buffers.push(d));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = 595.28, H = 841.89;
    const ML = 42, MR = 34, MT = 136, MB = 43;
    const CW = W - ML - MR;

    const logoPath = path.join(__dirname, 'IMG_0212.jpeg');

    // BANDE JAUNE
    doc.rect(0, 0, 14, H).fill(JAUNE);

    // LOGO
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, ML, 18, { width: 110, height: 75 }); } catch(e) {}
    }

    // INFOS SOCIÉTÉ
    doc.fontSize(7.5).fillColor(GRIS_MED).font('Helvetica');
    ['128 Rue La Boetie, 75008 Paris','Tel : 07 87 38 86 22','sinelec.paris@gmail.com','SIRET : 91015824500019']
      .forEach((line, i) => doc.text(line, ML, 96 + i * 10.5));

    // TITRE
    const titre = type === 'facture' ? 'FACTURE' : 'DEVIS';
    doc.fontSize(42).font('Helvetica-Bold').fillColor(NOIR).text(titre, 0, 18, { width: W - MR, align: 'right' });
    doc.rect(W - 227, 61, 193, 5).fill(JAUNE);
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NOIR).text(`N\xB0 ${data.num}`, 0, 74, { width: W - MR, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor(GRIS_MED);
    doc.text(`Date : ${data.date}`, 0, 84, { width: W - MR, align: 'right' });
    if (type === 'devis') doc.text(`Valable jusqu'au : ${data.valide}`, 0, 94, { width: W - MR, align: 'right' });

    // LIGNE SÉPARATRICE
    doc.moveTo(ML, 108).lineTo(W - MR, 108).lineWidth(0.5).strokeColor(GRIS_LINE).stroke();

    // BLOCS DE / POUR
    doc.fontSize(7).font('Helvetica-Bold').fillColor(JAUNE).text('DE', ML, MT);
    doc.rect(ML, MT + 10, 3, 52).fill(JAUNE);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NOIR).text('SINELEC PARIS', ML + 8, MT + 12);
    doc.fontSize(8.5).font('Helvetica').fillColor(GRIS_DARK);
    doc.text('128 Rue La Boetie, 75008 Paris', ML + 8, MT + 25);
    doc.text('07 87 38 86 22  |  sinelec.paris@gmail.com', ML + 8, MT + 37);

    const pourX = W / 2 + 10;
    doc.rect(pourX - 12, MT - 4, 230, 68).fill('#FFFBF2');
    doc.rect(pourX - 12, MT - 4, 3, 68).fill(JAUNE);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(JAUNE).text('CLIENT', pourX - 2, MT);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(NOIR).text(data.client, pourX - 2, MT + 12);
    doc.fontSize(8.5).font('Helvetica').fillColor(GRIS_DARK).text(data.adresse, pourX - 2, MT + 28, { width: 200 });
    if (data.email) doc.text(data.email, pourX - 2, MT + 42, { width: 200 });

    let y = MT + 80;

    // TABLEAU
    const cols = [22, 188, 44, 28, 65, 85];
    // Colonne désignation élargie : on va afficher nom + détail
    const headers = ['#', 'DESIGNATION / DETAIL', 'QTE', 'U.', 'PRIX U. HT', 'TOTAL HT'];
    const headerH = 26;

    doc.rect(ML, y, CW, headerH).fill(NOIR);
    doc.rect(ML, y + headerH - 3, CW, 3).fill(JAUNE);
    let hx = ML + 8;
    headers.forEach((h, i) => {
      const align = i >= 4 ? 'right' : (i === 0 ? 'center' : 'left');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF');
      doc.text(h, hx, y + 8, { width: cols[i] - 4, align });
      hx += cols[i];
    });
    y += headerH;

    data.lignes.forEach((l, idx) => {
      const detail = getDetail(l.designation);
      const detailH = doc.heightOfString(detail, { width: cols[1] - 8, lineGap: 2 });
      const rowH = Math.max(50, detailH + 28);
      const bg = idx % 2 === 0 ? '#FFFFFF' : GRIS_BG;
      doc.rect(ML, y, CW, rowH).fill(bg);
      doc.moveTo(ML, y + rowH).lineTo(ML + CW, y + rowH).lineWidth(0.3).strokeColor(GRIS_LINE).stroke();

      let lx = ML + 8;
      // Numéro
      doc.fontSize(9).font('Helvetica').fillColor(GRIS_MED).text(String(idx+1), lx, y + 10, { width: cols[0] - 4, align: 'center' });
      lx += cols[0];

      // Désignation + détail
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text(l.designation, lx, y + 8, { width: cols[1] - 8 });
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS_DARK).text(detail, lx, y + 20, { width: cols[1] - 8, lineGap: 2 });
      lx += cols[1];

      // Qte
      doc.fontSize(9).font('Helvetica').fillColor(NOIR).text(String(l.qte), lx, y + 10, { width: cols[2] - 4, align: 'center' });
      lx += cols[2];

      // Unité
      doc.fontSize(9).font('Helvetica').fillColor(GRIS_MED).text('u', lx, y + 10, { width: cols[3] - 4, align: 'center' });
      lx += cols[3];

      // Prix U
      doc.fontSize(9).font('Helvetica').fillColor(NOIR).text(`${parseFloat(l.prixUnit).toFixed(2)} EUR`, lx, y + 10, { width: cols[4] - 8, align: 'right' });
      lx += cols[4];

      // Total
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text(`${parseFloat(l.total).toFixed(2)} EUR`, lx, y + 10, { width: cols[5] - 8, align: 'right' });

      y += rowH;
    });

    // TOTAUX
    y += 10;
    doc.moveTo(ML + CW * 0.52, y).lineTo(ML + CW, y).lineWidth(0.5).strokeColor(GRIS_LINE).stroke();
    y += 8;
    doc.fontSize(9).font('Helvetica').fillColor(GRIS_DARK).text('Total HT', ML, y, { width: CW - 85, align: 'right' });
    doc.fontSize(9).font('Helvetica').fillColor(NOIR).text(`${data.totalHT.toFixed(2)} EUR`, ML + CW - 83, y, { width: 83, align: 'right' });
    y += 16;
    doc.fontSize(8).font('Helvetica').fillColor(GRIS_MED).text('TVA', ML, y, { width: CW - 170, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor(GRIS_MED).text('Non applicable (art. 293B)', ML + CW - 168, y, { width: 168, align: 'right' });
    y += 14;

    // NET À PAYER
    doc.rect(ML, y, CW, 36).fill(NOIR);
    doc.rect(ML, y + 36, CW, 4).fill(JAUNE);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#FFFFFF').text('NET A PAYER', ML + 14, y + 10);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(JAUNE).text(`${data.totalHT.toFixed(2)} EUR`, ML, y + 9, { width: CW - 14, align: 'right' });

    // TAMPON ACQUITTÉ
    if (type === 'facture') {
      const cx = W * 0.65, cy = y - 60;
      doc.save();
      doc.translate(cx, cy).rotate(-30);
      doc.circle(0, 0, 52).lineWidth(3).strokeColor('#CC0000').stroke();
      doc.circle(0, 0, 48).lineWidth(1).strokeColor('#CC0000').stroke();
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#CC0000').text('ACQUITTE', -38, -10);
      doc.fontSize(8).font('Helvetica').fillColor('#CC0000').text(data.date, -16, 8);
      doc.restore();
    }

    y += 50;

    // CONDITIONS
    doc.moveTo(ML, y).lineTo(ML + CW, y).lineWidth(0.3).strokeColor(GRIS_LINE).stroke();
    y += 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NOIR).text('CONDITIONS', ML, y);
    y += 14;

    if (type === 'devis') {
      doc.fontSize(9).font('Helvetica').fillColor(GRIS_DARK).text('Acompte de 40% a la signature', ML, y);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#D4891A').text(`${(data.totalHT * 0.4).toFixed(2)} EUR`, ML, y, { width: CW, align: 'right' });
      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor(GRIS_DARK).text('Reste a facturer a la fin des travaux', ML, y);
      doc.fontSize(9).font('Helvetica').fillColor(NOIR).text(`${(data.totalHT * 0.6).toFixed(2)} EUR`, ML, y, { width: CW, align: 'right' });
      y += 14;
      doc.fontSize(8).font('Helvetica').fillColor(GRIS_MED).text('Devis valable 30 jours — Paiement : virement, especes, carte bancaire', ML, y);
      y += 20;
    }

    // IBAN
    doc.rect(ML, y, CW, 32).fill(GRIS_LIGHT);
    doc.rect(ML, y, 3, 32).fill(JAUNE);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS_MED).text('IBAN', ML + 10, y + 7);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text('FR76 1695 8000 0174 2540 5920 931', ML + 38, y + 7);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS_MED).text('BIC', ML + CW - 100, y + 7);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text('QNTOFRP1XXX', ML + CW - 80, y + 7);
    doc.fontSize(7).font('Helvetica').fillColor(GRIS_MED).text('TVA non applicable art. 293B CGI — Garantie decennale ORUS', ML + 10, y + 20);
    y += 42;

    // SIGNATURES
    if (type === 'devis') {
      const sigW = (CW - 10) / 2;
      doc.rect(ML, y, sigW, 55).lineWidth(0.5).strokeColor(GRIS_LINE).stroke();
      doc.rect(ML, y, 3, 55).fill(JAUNE);
      doc.fontSize(9).font('Helvetica').fillColor(GRIS_DARK).text('Bon pour accord - Signature client :', ML + 10, y + 10);
      doc.fontSize(8.5).font('Helvetica').fillColor(GRIS_DARK).text('Date : _______________', ML + 10, y + 40);
      doc.rect(ML + sigW + 10, y, sigW, 55).lineWidth(0.5).strokeColor(GRIS_LINE).stroke();
      doc.rect(ML + sigW + 10, y, 3, 55).fill(NOIR);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text('Signature SINELEC Paris', ML + sigW + 20, y + 10);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NOIR).text('SINELEC PARIS', ML + sigW + 20, y + 40);
    }

    // FOOTER
    doc.rect(14, H - 29, W, 29).fill(NOIR);
    doc.rect(14, H - 31, W, 2).fill(JAUNE);
    doc.fontSize(6.5).font('Helvetica').fillColor('#777777')
      .text('SINELEC EI  -  128 Rue La Boetie 75008 Paris  -  SIRET : 91015824500019  -  TVA non applicable art. 293B CGI  -  Garantie decennale ORUS', 0, H - 20, { width: W, align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor(JAUNE)
      .text(`${data.num}  |  Page 1 / 1`, 0, H - 13, { width: W - MR, align: 'right' });

    doc.end();
  });
}

// ── ROUTES ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'app.html')));

app.post('/generer-devis', async (req, res) => {
  try {
    const { client, adresse, email, lignes, description, numDevis } = req.body;
    const totalHT = lignes.reduce((s, l) => s + (l.qte * l.prixUnit), 0);

    let compteur = { num: 0 };
    try { compteur = JSON.parse(fs.readFileSync('compteur_devis.json','utf8')); } catch(e) {}
    compteur.num = (compteur.num || 0) + 1;
    fs.writeFileSync('compteur_devis.json', JSON.stringify(compteur));

    const now = new Date();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const num = numDevis || `OS-${yyyy}${mm}-${String(compteur.num).padStart(3,'0')}`;
    const date = now.toLocaleDateString('fr-FR');
    const valide = new Date(new Date().setDate(new Date().getDate()+30)).toLocaleDateString('fr-FR');

    const lignesFormatted = lignes.map(l => ({
      designation: l.designation,
      qte: l.qte,
      prixUnit: l.prixUnit,
      total: l.qte * l.prixUnit
    }));

    const pdfBuffer = await genererPDFBuffer({
      num, date, valide, client, adresse, email,
      designation: description || 'Travaux électriques SINELEC Paris',
      lignes: lignesFormatted, totalHT
    }, 'devis');

    if (email && process.env.GMAIL_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com", port: 465, secure: true,
          auth: { user: 'sinelec.paris@gmail.com', pass: process.env.GMAIL_PASS }
        });
        await transporter.sendMail({
          from: '"SINELEC Paris" <sinelec.paris@gmail.com>',
          to: email,
          subject: `Votre devis SINELEC Paris - ${num}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#111;padding:20px;text-align:center"><h1 style="color:#F5A623;margin:0">SINELEC PARIS</h1><p style="color:#fff;margin:5px 0">Électricien 24h/24 — Paris & Île-de-France</p></div><div style="padding:30px"><p>Bonjour <strong>${client}</strong>,</p><p>Veuillez trouver ci-joint votre devis <strong>${num}</strong>.</p><div style="background:#F5F5F5;padding:15px;border-left:4px solid #F5A623;margin:20px 0"><p style="margin:0"><strong>Total HT : ${totalHT.toFixed(2)} €</strong></p><p style="margin:4px 0;font-size:12px;color:#666">TVA non applicable - Art. 293B CGI</p></div><p>Cordialement,<br><strong>SINELEC Paris</strong><br>07 87 38 86 22</p></div></div>`,
          attachments: [{ filename: `${num}.pdf`, content: pdfBuffer }]
        });
      } catch(e) { console.log('Email error:', e.message); }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/generer-facture', async (req, res) => {
  try {
    const { client, adresse, email, lignes, description } = req.body;
    const totalHT = lignes.reduce((s, l) => s + (l.qte * l.prixUnit), 0);

    let compteur = { num: 0 };
    try { compteur = JSON.parse(fs.readFileSync('compteur_facture.json','utf8')); } catch(e) {}
    compteur.num = (compteur.num || 0) + 1;
    fs.writeFileSync('compteur_facture.json', JSON.stringify(compteur));

    const now = new Date();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const num = `FA-${yyyy}${mm}-${String(compteur.num).padStart(3,'0')}`;
    const date = now.toLocaleDateString('fr-FR');

    const lignesFormatted = lignes.map(l => ({
      designation: l.designation,
      qte: l.qte,
      prixUnit: l.prixUnit,
      total: l.qte * l.prixUnit
    }));

    const pdfBuffer = await genererPDFBuffer({
      num, date, client, adresse, email,
      designation: description || 'Travaux électriques réalisés',
      lignes: lignesFormatted, totalHT,
      acquitte: true
    }, 'facture');

    if (email && process.env.GMAIL_PASS) {
      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com", port: 465, secure: true,
          auth: { user: 'sinelec.paris@gmail.com', pass: process.env.GMAIL_PASS }
        });
        await transporter.sendMail({
          from: '"SINELEC Paris" <sinelec.paris@gmail.com>',
          to: email,
          subject: `Votre facture SINELEC Paris - ${num}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#111;padding:20px;text-align:center"><h1 style="color:#F5A623;margin:0">SINELEC PARIS</h1></div><div style="padding:30px"><p>Bonjour <strong>${client}</strong>,</p><p>Veuillez trouver ci-joint votre facture <strong>${num}</strong>.</p><div style="background:#F5F5F5;padding:15px;border-left:4px solid #F5A623;margin:20px 0"><p style="margin:0"><strong>Total : ${totalHT.toFixed(2)} €</strong></p><p style="margin:4px 0;font-size:12px;color:#666">TVA non applicable - Art. 293B CGI</p></div><p>Cordialement,<br><strong>SINELEC Paris</strong><br>07 87 38 86 22</p></div></div>`,
          attachments: [{ filename: `${num}.pdf`, content: pdfBuffer }]
        });
      } catch(e) { console.log('Email error:', e.message); }
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTE RÉDACTION RAPPORT ──
app.post('/api/rapport', async (req, res) => {
  try {
    const { contexte } = req.body;
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Tu es SINELEC PARIS, électricien professionnel Paris et IDF, spécialisé dépannage et mise aux normes NF C 15-100.

Le technicien décrit ce chantier en quelques mots : "${contexte}"

Génère un rapport d'intervention professionnel avec :
1. "travaux" : description complète et technique des travaux réalisés (8-12 lignes). Mentionne le matériel utilisé (marques Schneider/Legrand/Hager si tableau), les normes respectées (NF C 15-100), la garantie décennale ORUS. Ton professionnel BTP.
2. "observations" : anomalies constatées et recommandations pour la suite (3-5 lignes). Si tout est conforme, mentionne-le.

Réponds UNIQUEMENT en JSON valide (sans markdown) :
{"travaux": "...", "observations": "..."}`
      }]
    });
    const text = msg.content[0].text.trim().replace(/```json|```/g, '').trim();
    const data = JSON.parse(text);
    res.json(data);
  } catch(e) {
    console.error('Rapport error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ROUTE CHATBOT ──
app.post('/api/chat', async (req, res) => {
  try {
    const { message, grille } = req.body;
    
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Tu es l'assistant de SINELEC Paris, électricien professionnel.
        
Voici la grille tarifaire disponible (JSON) :
${grille}

Le technicien décrit ce chantier : "${message}"

Analyse et retourne UNIQUEMENT un JSON valide (sans markdown) avec cette structure :
{
  "prestations": [
    {"designation": "nom exact de la prestation dans la grille", "qte": 1, "prixUnit": 50},
    ...
  ],
  "total": 123.00,
  "message": "Explication courte de ce que j'ai sélectionné"
}

RÈGLES IMPORTANTES :
- Utilise UNIQUEMENT les désignations exactes qui existent dans la grille
- Inclus toujours le déplacement si c'est une intervention
- Détecte le type d'urgence (jour/soir/nuit) si mentionné
- Si tu ne comprends pas, retourne {"prestations": [], "total": 0, "message": "explication"}
- Réponds UNIQUEMENT avec le JSON, rien d'autre`
      }]
    });

    const text = msg.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    res.json(data);

  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ prestations: [], total: 0, message: 'Erreur serveur' });
  }
});

// ── ROUTE EMAIL VIA BREVO ──
app.post('/envoyer-email', async (req, res) => {
  try {
    const { email, client, num, totalHT, type, pdfBase64 } = req.body;
    if (!email || !pdfBase64) return res.status(400).json({ error: 'Manque email ou PDF' });

    const sujet = type === 'facture'
      ? `Votre facture SINELEC Paris - ${num}`
      : type === 'rapport'
      ? `Rapport d'intervention SINELEC Paris - ${num}`
      : `Votre devis SINELEC Paris - ${num}`;

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SINELEC Paris', email: 'sinelec.paris@gmail.com' },
        to: [{ email: email }],
        subject: sujet,
        htmlContent: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#111;padding:20px;text-align:center">
            <h1 style="color:#F5A623;margin:0">SINELEC PARIS</h1>
            <p style="color:#fff;margin:5px 0">Electricien 24h/24 - Paris & Ile-de-France</p>
          </div>
          <div style="padding:30px">
            <p>Bonjour <strong>${client}</strong>,</p>
            <p>Veuillez trouver ci-joint votre ${type === 'facture' ? 'facture' : 'devis'} <strong>${num}</strong>.</p>
            <div style="background:#F5F5F5;padding:15px;border-left:4px solid #F5A623;margin:20px 0">
              <p style="margin:0"><strong>Total HT : ${parseFloat(totalHT).toFixed(2)} EUR</strong></p>
              <p style="margin:4px 0;font-size:12px;color:#666">TVA non applicable - Art. 293B CGI</p>
            </div>
            <p>Cordialement,<br><strong>SINELEC Paris</strong><br>07 87 38 86 22</p>
          </div>
        </div>`,
        attachment: [{
          name: `${num}.pdf`,
          content: pdfBase64,
        }]
      })
    });

    if (response.ok) {
      console.log(`Email envoye a ${email} - ${num}`);
      res.json({ success: true });
    } else {
      const err = await response.json();
      console.log('Brevo error:', err);
      res.status(400).json({ error: err.message || 'Erreur Brevo' });
    }
  } catch(e) {
    console.error('Email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur SINELEC démarré !`);
  console.log(`📱 Accessible sur : https://sinelec-api-production.up.railway.app/app.html`);
});
