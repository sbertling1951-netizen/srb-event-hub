type Props = {
  name: string;
  address?: string;
  phone?: string;
  category?: string;
};

export function LocationCard({ name, address, phone, category }: Props) {
  return (
    <div style={{
      border: '1px solid #ddd',
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
      background: '#fff'
    }}>
      <strong>{name}</strong>
      {category && <div style={{ fontSize: 12, opacity: 0.7 }}>{category}</div>}
      {address && <div>{address}</div>}
      {phone && <div>{phone}</div>}
    </div>
  );
}
