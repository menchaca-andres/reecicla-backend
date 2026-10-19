export function originalPriceWasConfirmed(
  declaredCondition: string | null,
  actualCondition: string,
  result: 'RESALE' | 'RECYCLE'
): boolean {
  return result === 'RESALE' &&
    typeof declaredCondition === 'string' &&
    declaredCondition.trim().toLowerCase() === actualCondition.trim().toLowerCase();
}
