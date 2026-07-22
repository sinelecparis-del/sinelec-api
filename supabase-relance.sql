-- Ajouter colonnes pour relance automatique
ALTER TABLE historique 
ADD COLUMN IF NOT EXISTS statut text DEFAULT 'envoyé',
ADD COLUMN IF NOT EXISTS date_relance timestamptz,
ADD COLUMN IF NOT EXISTS nb_relances int DEFAULT 0;

-- Créer index pour optimiser les requêtes de relance
CREATE INDEX IF NOT EXISTS idx_relance ON historique(type, statut, created_at, nb_relances);
