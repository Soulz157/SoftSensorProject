export const getJwtToken = (header: string) => {
  const [type, token] = header?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
};
