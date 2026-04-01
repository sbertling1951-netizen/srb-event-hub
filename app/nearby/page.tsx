'use client';

import { useEffect, useState } from 'react';
import { LocationCard } from '@/components/LocationCard';

type Place = {
  name: string;
  address: string;
  phone?: string;
  category: string;
};

const categories = ['Fuel', 'Urgent Care', 'Pharmacy', 'Groceries'];

export default function NearbyPage() {
  const [places, setPlaces] = useState<Place[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('nearby');
    if (saved) {
      setPlaces(JSON.parse(saved));
    }
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <span className="badge success">Auto-Built Nearby List Ready</span>
        <h1>Nearby</h1>
        <p className="subtle">
          This screen is where members can quickly find useful places around the event such as fuel, urgent care,
          pharmacy, groceries, and other local stops.
        </p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          {categories.map((category) => (
            <span key={category} className="badge">
              {category}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        {places.map((place) => (
          <div key={place.name} className="card">
            <LocationCard {...place} />
          </div>
        ))}
      </div>
    </div>
  );
}
