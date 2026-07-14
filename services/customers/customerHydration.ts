export type CustomerCollectionReader = () => Promise<unknown>;

export const hydrateCustomerState = async <T>(
  readCustomers: CustomerCollectionReader,
  setCustomers: (customers: T[]) => void,
): Promise<T[]> => {
  const storedCustomers = await readCustomers();
  const customers = Array.isArray(storedCustomers) ? storedCustomers as T[] : [];

  setCustomers(customers);
  return customers;
};
