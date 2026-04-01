export type Place = {
  name: string;
  address: string;
  phone?: string;
  category: string;
};

export const nearby: Place[] = [
  {
    name: 'Chevron Truck Stop',
    address: '1234 Hwy 65, Branson, MO',
    phone: '417-555-1234',
    category: 'Fuel',
  },
  {
    name: 'Cox Urgent Care',
    address: '5678 Medical Dr, Branson, MO',
    phone: '417-555-5678',
    category: 'Urgent Care',
  },
  {
    name: 'Walgreens',
    address: '901 Main St, Branson, MO',
    phone: '417-555-9012',
    category: 'Pharmacy',
  },
  {
    name: 'Walmart Supercenter',
    address: '1000 Walmart Way, Branson, MO',
    phone: '417-555-0000',
    category: 'Groceries',
  },
];
