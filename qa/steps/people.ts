import { newPhone, type Lender, type Named } from './lender';

// Customers and Standalone Referrers, found by name and seeded through the API.

export type Person = { id: number; name: string; phone: string };

/** The Customer called `name`, with their Primary Number. */
export async function customerNamed(lender: Lender, name: string): Promise<Person> {
  const { id, phone_1 } = (await lender.customerNamed(name)) as Named & { phone_1: string };
  return { id, name, phone: phone_1 };
}

/** The Standalone Referrer called `name`. */
export async function referrerNamed(lender: Lender, name: string): Promise<Person> {
  const found = (await lender.get('/api/search', { q: name })).filter(
    (hit: Person & { kind: string }) => hit.kind === 'referrer' && hit.name === name,
  );
  if (found.length !== 1) throw new Error(`expected one Referrer ${name}, found ${found.length}`);
  return found[0];
}

/** A Customer with a Primary Number no other scenario uses, and any other details. */
export async function addCustomer(lender: Lender, name: string, details: Record<string, unknown> = {}) {
  return lender.post('/api/customers', { name, address: '1 Test Street', phone_1: newPhone(), ...details });
}
