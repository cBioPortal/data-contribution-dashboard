/**
 * Utility functions for extracting and managing years from study data
 */

export interface Study {
    studyId?: string;
    name?: string;
    citation?: string;
    [key: string]: any;
  }
  
  /**
   * Extract year from a study object using multiple strategies
   * @param study - The study object to extract year from
   * @param fallbackYear - Year to use if no year can be extracted (default: current year)
   * @returns The extracted year or fallback year
   */
  export const extractYearFromStudy = (study: Study, fallbackYear?: number): number => {
    const defaultFallback = fallbackYear ?? 2026; // matches backend YEAR_EXPR fallback
    
    // Strategy 1: Try to extract year from citation first
    if (study.citation) {
      const yearMatch = study.citation.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        return parseInt(yearMatch[0]);
      }
    }
    
    // Strategy 2: Try to extract from name
    if (study.name) {
      const yearMatch = study.name.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        return parseInt(yearMatch[0]);
      }
      
      // Strategy 3: Check for special patterns in study name
      const studyName = study.name.toLowerCase();
      
      // TCGA Firehose Legacy studies
      if (studyName.includes('tcga') && studyName.includes('firehose legacy')) {
        return 2011;
      }
      
      // TARGET GDC studies
      if (studyName.includes('target') && studyName.includes('gdc')) {
        return 2024;
      }
      
      // TCGA GDC studies
      if (studyName.includes('tcga') && studyName.includes('gdc')) {
        return 2024;
      }
      
      // CPTAC GDC studies
      if (studyName.includes('cptac') && studyName.includes('gdc')) {
        return 2024;
      }
    }
    
    // Strategy 4: Try to extract from studyId
    if (study.studyId) {
      const yearMatch = study.studyId.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        return parseInt(yearMatch[0]);
      }
    }
    
    // If no year found, return fallback
    return defaultFallback;
  };
  
  /**
   * Extract years from an array of studies
   * @param studies - Array of study objects
   * @param minYear - Minimum year to include (default: 2011)
   * @param includeFallback - Whether to include studies with fallback years (default: true)
   * @returns Array of years with their study counts
   */
  export const extractYearsFromStudies = (
    studies: Study[],
    minYear: number = 2011,
    includeFallback: boolean = true
  ): Map<number, number> => {
    const yearCounts = new Map<number, number>();
    const currentYear = new Date().getFullYear();
    
    studies.forEach(study => {
      const year = extractYearFromStudy(study, includeFallback ? currentYear : undefined);
      
      // Only include years that meet the minimum threshold
      if (year >= minYear) {
        yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
      }
    });
    
    return yearCounts;
  };
  
  /**
   * Get a sorted array of unique years from studies
   * @param studies - Array of study objects
   * @param minYear - Minimum year to include (default: 2011)
   * @param sortOrder - Sort order: 'asc' or 'desc' (default: 'desc')
   * @returns Sorted array of years
   */
  export const getAvailableYears = (
    studies: Study[],
    minYear: number = 2011,
    sortOrder: 'asc' | 'desc' = 'desc'
  ): number[] => {
    const years = new Set<number>();
    
    studies.forEach(study => {
      const year = extractYearFromStudy(study);
      
      if (year >= minYear) {
        years.add(year);
      }
    });
    
    const sortedYears = Array.from(years).sort((a, b) => a - b);
    
    return sortOrder === 'desc' ? sortedYears.reverse() : sortedYears;
  };
  
  /**
   * Constants for commonly used years
   */
  export const YEAR_CONSTANTS = {
    MIN_YEAR: 2011,
    TCGA_FIREHOSE: 2011,
    GDC_RELEASE: 2024,
  } as const;