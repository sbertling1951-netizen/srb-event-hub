'use client';

import { useEffect, useState } from 'react';

type Place = {
  name: string;
  address: string;
  phone?: string;
  category: string;
};

export default function AdminNearbyPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('Fuel');

  useEffect(() => {
    const saved = localStorage.getItem('nearby');
    if (saved) {
      setPlaces(JSON.parse(saved));
    }
  }, []);

  function savePlaces(next: Place[]) {
    localStorage.setItem('nearby', JSON.stringify(next));
    setPlaces(next);
  }

  function addPlace() {
    if (!name.trim() || !address.trim() || !category.trim()) {
      alert('Name, address, and category are required.');
      return;
    }

    const newPlace: Place = {
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim() || undefined,
      category: category.trim(),
    };

    savePlaces([...places, newPlace]);

    setName('');
    setAddress('');
    setPhone('');
    setCategory('Fuel');
  }

  function clearNearby() {
    localStorage.removeItem('nearby');
    setPlaces([]);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h1>Nearby Setup</h1>
        <p className="subtle">Add nearby places for members to see in the Nearby page.</p>

        <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
          <div>
            <label>Location name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pilot Travel Center"
            />
          </div>

          <div>
            <label>Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Branson, MO"
            />
          </div>

          <div>
            <label>Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-1212"
            />
          </div>

          <div>
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>Fuel</option>
              <option>Urgent Care</option>
              <option>Pharmacy</option>
              <option>Groceries</option>
              <option>Restaurant</option>
              <option>Attraction</option>
              <option>Tour Pickup</option>
            </select>
          </div>

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={addPlace}>
              Add Location
            </button>

            <button className="btn secondary" onClick={clearNearby}>
              Clear Nearby
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Saved nearby locations</h2>

        {places.length === 0 ? (
          <p className="subtle">No nearby locations saved yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Address</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {places.map((place, index) => (
                  <tr key={`${place.name}-${index}`}>
                    <td>{place.name}</td>
                    <td>{place.category}</td>
                    <td>{place.address}</td>
                    <td>{place.phone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
