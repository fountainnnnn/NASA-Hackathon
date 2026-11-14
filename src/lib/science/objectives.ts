import type { ScienceObjective } from '@/lib/contracts';

/**
 * Objective -> USGS SIM 3464 (Jezero crater and Nili Planum) map units.
 * Every mapping cites the unit's own Unit_Description / Unit_Interpretation / Additional_Characteristics text
 * (quotes verbatim from the published map database) so no association is invented.
 * 'astrobiology-samples' has no map unit: SIM 3464 does not map sampling; it is served by curated sites only.
 */
export interface UnitAssociation { symbol: string; evidence: string }

export const OBJECTIVE_UNITS: Record<ScienceObjective, UnitAssociation[]> = {
  'delta-sediments': [
    { symbol: 'NHjf2', evidence: 'Unit_Interpretation: "Deltaic fan deposits emplaced during the Late Noachian to Early Hesperian"; description: "located at the mouth of Neretva Vallis on the western portion of Jezero crater\'s floor"' },
    { symbol: 'NHjf1', evidence: 'Unit_Interpretation: "Degraded deltaic or lacustrine deposit emplaced during the Late Noachian before deposition of unit NHjf2"' },
  ],
  'crater-floor': [
    { symbol: 'Njf', evidence: 'Unit_Description: "forms the central portion of the Jezero crater floor and overlies and embays units Nue and Nle"' },
    { symbol: 'Nle', evidence: 'Unit_Description: "concentrically exposed on the floor of Jezero adjacent to unit Njf"' },
  ],
  'rim-bedrock': [
    { symbol: 'cr', evidence: 'Unit_Interpretation: "Undifferentiated target rock exposed and uplifted during impact"; characteristics: "Stratification is present in the Jezero crater rim"' },
    { symbol: 'Nnp1', evidence: 'Unit_Interpretation: "Crustal rocks of undetermined origin ... Nnp1 was the target rock for the Jezero impact"' },
  ],
  aeolian: [
    { symbol: 'Aeb', evidence: 'Unit_Interpretation: "Amazonian-aged bedforms and transverse aeolian ridges (TARs) composed of unconsolidated sediment"; description: "including along the interior margin of Jezero crater"' },
  ],
  'astrobiology-samples': [],
};
