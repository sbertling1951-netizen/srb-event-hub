import { activities } from '@/lib/mock-data';
import { getCutoffLabel } from '@/lib/cutoff';
import LocationCard from '@/app/components/LocationCard';

export default function ActivitiesPage() {
  return (
    <div className="grid">
      {activities.map((activity) => {
        const cutoff = getCutoffLabel(activity.signupCloseAt);
        return (
          <div key={activity.id} className="grid grid-2">
            <div className="card">
              <div className="spread">
                <div>
                  <h2>{activity.title}</h2>
                  <div className="muted">{activity.category} • {activity.date} • {activity.startTime} to {activity.endTime}</div>
                </div>
                <span className={`badge ${cutoff.kind}`}>{cutoff.label}</span>
              </div>
              <p><strong>Meeting location:</strong> {activity.meetingLocation}</p>
              <p><strong>Seats:</strong> {activity.booked}/{activity.capacity}</p>
              <p><strong>Price:</strong> ${activity.price.toFixed(2)}</p>
              {activity.rvNote ? <p><strong>Travel note:</strong> {activity.rvNote}</p> : null}
              <div className="row">
                <button className="button">Register</button>
                <button className="button-secondary">Join waitlist</button>
              </div>
            </div>
            <LocationCard
              name={activity.meetingLocation}
              category="Activity meeting point"
              address={activity.address}
              latitude={activity.latitude}
              longitude={activity.longitude}
              rvNote={activity.rvNote}
            />
          </div>
        );
      })}
    </div>
  );
}
