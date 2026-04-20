require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ═════════════════ CONFIGURATION ═════════════════
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

// ═════════════════ MIDDLEWARE ═════════════════
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

// ═════════════════ HEALTHCHECK ═════════════════
app.get('/', (req, res) => res.send('✅ SINELEC API OK'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SINELEC API' }));

// ═════════════════ HELPER: ENVOI EMAIL BREVO ═════════════════
async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  console.log('📧 Tentative envoi email à:', to);
  console.log('📧 Sujet:', subject);
  
  const payload = {
    sender: { name: 'SINELEC Paris', email: 'contact@sinelecparis.fr' },
    to: [{ email: to }],
    subject,
    htmlContent,
  };

  if (attachment) {
    payload.attachment = [
      {
        content: attachment.content,
        name: attachment.name,
      },
    ];
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('❌ Erreur Brevo:', err);
      throw new Error(`Brevo error: ${err}`);
    }

    const result = await res.json();
    console.log('✅ Email envoyé avec succès !', result);
    return result;
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi email:', error);
    throw error;
  }
}

// ═════════════════ ENDPOINT: GENERER DEVIS/FACTURE ═════════════════
app.post('/api/generer', async (req, res) => {
  try {
    const { type, client, adresse, tel, cp, email, description, prestations, totalht } = req.body;

    // Récupérer compteur
    const { data: compteurs, error: errComp } = await supabase
      .from('compteurs')
      .select('*')
      .eq('type', type)
      .single();

    let num;
    if (errComp || !compteurs) {
      const initNum = 1;
      await supabase.from('compteurs').insert({ type, counter: initNum });
      num = `${type === 'devis' ? 'OS' : 'FA'}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(initNum).padStart(3, '0')}`;
    } else {
      const newCounter = compteurs.counter + 1;
      await supabase.from('compteurs').update({ counter: newCounter }).eq('type', type);
      num = `${type === 'devis' ? 'OS' : 'FA'}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(newCounter).padStart(3, '0')}`;
    }

    // Enregistrer dans historique
    await supabase.from('historique').insert({
      num,
      type,
      client,
      adresse,
      tel,
      cp,
      email,
      description,
      prestations: JSON.stringify(prestations),
      totalht,
      statut: type === 'devis' ? 'envoyé' : 'payée',
      date: new Date().toLocaleDateString('fr-FR'),
    });

    // Email
    if (email) {
      console.log('📧 Préparation email pour:', email);
      const typeLabel = type === 'devis' ? 'Devis' : 'Facture';
      const subject = `${typeLabel} SINELEC ${num}`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#F5A623,#d4a574);padding:30px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:28px;">⚡ SINELEC Paris</h1>
            <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">Électricité 24h/24 - Île-de-France</p>
          </div>
          <div style="background:#fff;padding:30px;border:1px solid #eee;border-top:none;">
            <h2 style="color:#333;margin:0 0 20px;">Bonjour ${client},</h2>
            <p style="color:#666;line-height:1.6;">Veuillez trouver ci-joint votre ${typeLabel.toLowerCase()} <strong>${num}</strong> d'un montant de <strong>${totalht.toFixed(2)} € HT</strong>.</p>
            ${type === 'devis' ? '<p style="color:#666;line-height:1.6;">Ce devis est valable 30 jours. Pour toute question, n\'hésitez pas à nous contacter.</p>' : ''}
            <div style="background:#f9f9f9;border-left:4px solid #F5A623;padding:16px;margin:20px 0;border-radius:8px;">
              <p style="margin:0;color:#666;font-size:14px;"><strong>Montant total HT :</strong> ${totalht.toFixed(2)} €</p>
            </div>
            <p style="color:#666;line-height:1.6;">Cordialement,<br><strong>L'équipe SINELEC Paris</strong></p>
          </div>
          <div style="background:#f5f5f5;padding:20px;text-align:center;font-size:12px;color:#888;border-radius:0 0 12px 12px;">
            <p style="margin:0;">SINELEC Paris - 128 rue La Boétie, 75008 Paris</p>
            <p style="margin:8px 0 0;">SIRET 91015824500019 - TVA non applicable art. 293B CGI</p>
          </div>
        </div>
      `;

      await envoyerEmail(email, subject, html);
    }

    res.json({ success: true, num });
  } catch (err) {
    console.error('Erreur /api/generer:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═════════════════ ENDPOINT: CHAT CLAUDE ═════════════════
app.post('/api/chat', async (req, res) => {
  try {
    const { message, grille } = req.body;
    const grilleObj = JSON.parse(grille);

    const prompt = `Tu es l'assistant SINELEC. L'utilisateur décrit un chantier électrique.

GRILLE TARIFAIRE SINELEC (HT, sans TVA):
${JSON.stringify(grilleObj, null, 2)}

MESSAGE UTILISATEUR: "${message}"

INSTRUCTIONS:
1. Analyse le message et identifie les prestations nécessaires
2. Trouve chaque prestation dans la grille tarifaire
3. Donne une quantité réaliste
4. Réponds UNIQUEMENT en JSON valide:

{
  "prestations": [
    {"designation": "nom exact de la grille", "prixUnit": prix, "qte": quantité, "categorie": "nom catégorie"}
  ],
  "message": "explication courte et pro"
}

Réponds UNIQUEMENT avec du JSON valide, rien d'autre.`;

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = resp.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Pas de JSON dans la réponse Claude');

    const parsed = JSON.parse(jsonMatch[0]);
    const total = parsed.prestations.reduce((sum, p) => sum + p.prixUnit * p.qte, 0);

    res.json({
      prestations: parsed.prestations,
      message: parsed.message,
      total,
    });
  } catch (err) {
    console.error('Erreur /api/chat:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════ ENDPOINT: RAPPORT INTERVENTION ═════════════════
app.post('/api/rapport', async (req, res) => {
  try {
    const { contexte, client, adresse, travaux, observations, photoAvant, photoApres, signature, email, pdfBase64 } = req.body;

    // Si contexte fourni → rédaction par Claude
    if (contexte && !travaux) {
      const prompt = `Tu es l'assistant SINELEC. Rédige un rapport d'intervention professionnel en 2 paragraphes max basé sur: "${contexte}"

Format:
- Travaux réalisés: [description technique pro]
- Observations: [remarques complémentaires si nécessaire]

Reste factuel, technique, NF C 15-100.`;

      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = resp.content[0].text.trim();
      const parts = text.split('Observations:');
      const travauxText = parts[0].replace('Travaux réalisés:', '').trim();
      const observationsText = parts[1] ? parts[1].trim() : '';

      return res.json({ travaux: travauxText, observations: observationsText });
    }

    // Sinon → Génération du rapport + envoi email
    const { data: compteurs, error: errComp } = await supabase
      .from('compteurs')
      .select('*')
      .eq('type', 'rapport')
      .single();

    let numRapport;
    if (errComp || !compteurs) {
      await supabase.from('compteurs').insert({ type: 'rapport', counter: 1 });
      numRapport = `RAPP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-001`;
    } else {
      const newCounter = compteurs.counter + 1;
      await supabase.from('compteurs').update({ counter: newCounter }).eq('type', 'rapport');
      numRapport = `RAPP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(newCounter).padStart(3, '0')}`;
    }

    // Enregistrer dans Supabase
    await supabase.from('rapports').insert({
      num: numRapport,
      client,
      adresse,
      travaux,
      observations,
      photo_avant: photoAvant || null,
      photo_apres: photoApres || null,
      signature: signature || null,
      date: new Date().toISOString(),
    });

    // Envoi email avec PDF
    if (email && pdfBase64) {
      const subject = `Rapport d'intervention SINELEC ${numRapport}`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#F5A623,#d4a574);padding:30px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:28px;">⚡ SINELEC Paris</h1>
            <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">Rapport d'intervention</p>
          </div>
          <div style="background:#fff;padding:30px;border:1px solid #eee;border-top:none;">
            <h2 style="color:#333;margin:0 0 20px;">Bonjour ${client},</h2>
            <p style="color:#666;line-height:1.6;">Veuillez trouver ci-joint le rapport d'intervention <strong>${numRapport}</strong> pour les travaux réalisés à votre domicile.</p>
            <div style="background:#f9f9f9;border-left:4px solid #F5A623;padding:16px;margin:20px 0;border-radius:8px;">
              <p style="margin:0;color:#666;font-size:14px;"><strong>Adresse :</strong> ${adresse}</p>
              <p style="margin:8px 0 0;color:#666;font-size:14px;"><strong>Date :</strong> ${new Date().toLocaleDateString('fr-FR')}</p>
            </div>
            <p style="color:#666;line-height:1.6;">L'installation a été réalisée selon les normes NF C 15-100 en vigueur.</p>
            <p style="color:#666;line-height:1.6;">Cordialement,<br><strong>L'équipe SINELEC Paris</strong></p>
          </div>
          <div style="background:#f5f5f5;padding:20px;text-align:center;font-size:12px;color:#888;border-radius:0 0 12px 12px;">
            <p style="margin:0;">SINELEC Paris - 128 rue La Boétie, 75008 Paris</p>
            <p style="margin:8px 0 0;">SIRET 91015824500019 - Assurance décennale ORUS</p>
          </div>
        </div>
      `;

      await envoyerEmail(email, subject, html, {
        content: pdfBase64.replace(/^data:application\/pdf;base64,/, ''),
        name: `Rapport_${numRapport}.pdf`,
      });
    }

    res.json({ success: true, num: numRapport, message: email ? 'Rapport envoyé par email !' : 'Rapport enregistré' });
  } catch (err) {
    console.error('Erreur /api/rapport:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═════════════════ ENDPOINT: HISTORIQUE ═════════════════
app.get('/api/historique', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('historique')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Erreur /api/historique:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════ ENDPOINT: SIGNATURE ═════════════════
app.post('/api/signature', async (req, res) => {
  try {
    const { num, signature } = req.body;

    await supabase.from('signatures').insert({
      num_devis: num,
      signature_base64: signature,
      date: new Date().toISOString(),
    });

    await supabase
      .from('historique')
      .update({ statut: 'signé' })
      .eq('num', num);

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur /api/signature:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═════════════════ ENDPOINT: CLIENTS ═════════════════
app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('historique')
      .select('client, adresse, totalht');

    if (error) throw error;

    const clientsMap = {};
    data.forEach((row) => {
      if (!clientsMap[row.client]) {
        clientsMap[row.client] = {
          nom: row.client,
          adresse: row.adresse,
          ca_total: 0,
          nb_interventions: 0,
        };
      }
      clientsMap[row.client].ca_total += parseFloat(row.totalht || 0);
      clientsMap[row.client].nb_interventions++;
    });

    const clientsList = Object.values(clientsMap).sort((a, b) => b.ca_total - a.ca_total);
    res.json(clientsList);
  } catch (err) {
    console.error('Erreur /api/clients:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════ ENDPOINT: RELANCE AUTO 48H ═════════════════
app.get('/check-relances', async (req, res) => {
  try {
    const now = new Date();
    const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .neq('statut', 'signé')
      .lt('created_at', h48ago.toISOString());

    if (error) throw error;

    let relancesEnvoyees = 0;

    for (const devis of data || []) {
      if (!devis.email) continue;

      const subject = `Relance - Devis SINELEC ${devis.num}`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#F5A623,#d4a574);padding:30px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:28px;">⚡ SINELEC Paris</h1>
          </div>
          <div style="background:#fff;padding:30px;border:1px solid #eee;border-top:none;">
            <h2 style="color:#333;margin:0 0 20px;">Bonjour ${devis.client},</h2>
            <p style="color:#666;line-height:1.6;">Nous vous avions transmis le devis <strong>${devis.num}</strong> il y a quelques jours.</p>
            <p style="color:#666;line-height:1.6;">Avez-vous eu l'occasion d'en prendre connaissance ?</p>
            <p style="color:#666;line-height:1.6;">Je reste à votre disposition pour toute question ou ajustement éventuel.</p>
            <p style="color:#666;line-height:1.6;">Cordialement,<br><strong>L'équipe SINELEC Paris</strong></p>
          </div>
        </div>
      `;

      await envoyerEmail(devis.email, subject, html);

      await supabase
        .from('historique')
        .update({ statut: 'relancé' })
        .eq('num', devis.num);

      relancesEnvoyees++;
    }

    res.json({ success: true, relances: relancesEnvoyees });
  } catch (err) {
    console.error('Erreur /check-relances:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═════════════════ DÉMARRAGE SERVEUR ═════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ Serveur SINELEC démarré !');
  console.log(`📍 Accessible sur : http://localhost:${PORT}/app.html`);
  console.log('🔄 Relance auto : /check-relances');
});
