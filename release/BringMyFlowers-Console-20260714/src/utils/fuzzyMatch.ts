/**
 * Fuzzy string matching utility
 * Handles typos, plural forms, and variations
 */

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity ratio (0-1) between two strings
 */
function similarityRatio(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
  const maxLength = Math.max(str1.length, str2.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

/**
 * Normalize flower names (handle plural forms)
 */
function normalizeFlowerName(name: string): string {
  const normalized = name.toLowerCase().trim();
  
  // Handle plural forms
  if (normalized.endsWith('ies')) {
    return normalized.slice(0, -3) + 'y'; // lilies -> lily
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss')) {
    return normalized.slice(0, -1); // roses -> rose
  }
  
  return normalized;
}

/**
 * Find best matching flower from inventory
 * Returns the matching item and confidence score
 */
export function findBestFlowerMatch(
  searchTerm: string,
  availableFlowers: string[]
): { match: string; confidence: number } | null {
  if (!searchTerm || availableFlowers.length === 0) {
    return null;
  }

  const normalizedSearch = normalizeFlowerName(searchTerm);
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const flower of availableFlowers) {
    const normalizedFlower = normalizeFlowerName(flower);
    
    // Check exact match first
    if (normalizedSearch === normalizedFlower) {
      return { match: flower, confidence: 1.0 };
    }
    
    // Check substring match
    if (normalizedFlower.includes(normalizedSearch) || normalizedSearch.includes(normalizedFlower)) {
      const score = 0.9;
      if (score > bestScore) {
        bestMatch = flower;
        bestScore = score;
      }
      continue;
    }
    
    // Calculate fuzzy similarity
    const similarity = similarityRatio(normalizedSearch, normalizedFlower);
    if (similarity > bestScore && similarity >= 0.7) { // 70% similarity threshold
      bestMatch = flower;
      bestScore = similarity;
    }
  }

  return bestMatch ? { match: bestMatch, confidence: bestScore } : null;
}

/**
 * Check if two flower names are similar enough to be considered the same
 */
export function areFlowerNamesSimilar(name1: string, name2: string, threshold: number = 0.75): boolean {
  const normalized1 = normalizeFlowerName(name1);
  const normalized2 = normalizeFlowerName(name2);
  
  if (normalized1 === normalized2) {
    return true;
  }
  
  const similarity = similarityRatio(normalized1, normalized2);
  return similarity >= threshold;
}
