/** El mismo criterio para el acceso y los selectores operativos de usuarios. */
export const isGeneratedAvatarPlaceholder = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('api.dicebear.com') ||
    normalized.includes('/avataaars/') ||
    normalized.includes('placeholder') ||
    normalized.includes('placehold.co')
  );
};
