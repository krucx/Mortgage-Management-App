/** Shared selectors for the mortgage app's forms. Prefer labels/roles over CSS. */
export const labels = {
  customerName: 'Name',
  customerAddress: 'Address',
  customerPhone1: 'Contact number 1',
  mortgageAmount: 'Principal lent (₹)',
  mortgageDescription: 'Description of the jewellery',
  mortgageName: 'Mortgage Name',
} as const;

export const buttons = {
  saveCustomer: 'Save',
  confirmAndSave: 'Confirm and save',
  createMortgage: 'Create Mortgage',
} as const;
