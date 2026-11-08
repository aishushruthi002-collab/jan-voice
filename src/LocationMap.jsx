import { useEffect } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./LocationMap.css";

const DEFAULT_CENTER = [20, 0];

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function statusMarkerIcon(status) {
  const markerStatus = ["Pending", "In Progress", "Resolved"].includes(status)
    ? status.toLowerCase().replace(" ", "-")
    : "pending";

  return L.divIcon({
    className: "janvoice-marker-shell",
    html: `<span class="janvoice-map-marker janvoice-map-marker-${markerStatus}"></span>`,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
    popupAnchor: [0, -30],
  });
}

function MapInteractions({ selection, onSelect, selectable, markers }) {
  const map = useMap();
  const selectedLatitude = selection?.latitude;
  const selectedLongitude = selection?.longitude;
  const markerPositionsKey = JSON.stringify(markers
    .filter((marker) => isValidCoordinate(marker.latitude, marker.longitude))
    .map((marker) => [marker.latitude, marker.longitude]));

  useMapEvents({
    click(event) {
      if (selectable) {
        onSelect({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
        });
      }
    },
  });

  useEffect(() => {
    map.invalidateSize();

    if (
      Number.isFinite(selectedLatitude) &&
      Number.isFinite(selectedLongitude)
    ) {
      map.setView([selectedLatitude, selectedLongitude], 15);
      return;
    }

    const markerPositions = JSON.parse(markerPositionsKey);
    if (markerPositions.length === 1) {
      map.setView(markerPositions[0], 14);
    } else if (markerPositions.length > 1) {
      map.fitBounds(markerPositions, { padding: [32, 32], maxZoom: 14 });
    }
  }, [map, selectedLatitude, selectedLongitude, markerPositionsKey]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    const container = map.getContainer();
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [map]);

  return null;
}

export default function LocationMap({
  selection = null,
  onSelect = () => {},
  selectable = false,
  markers = [],
  className = "",
}) {
  const validMarkers = markers.filter((marker) =>
    isValidCoordinate(marker.latitude, marker.longitude)
  );
  const initialCenter = selection
    ? [selection.latitude, selection.longitude]
    : validMarkers.length > 0
      ? [validMarkers[0].latitude, validMarkers[0].longitude]
      : DEFAULT_CENTER;

  return (
    <div className={`location-map ${className}`}>
      <MapContainer
        center={initialCenter}
        zoom={selection ? 15 : 2}
        scrollWheelZoom
        className="location-map-canvas"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInteractions
          selection={selection}
          onSelect={onSelect}
          selectable={selectable}
          markers={validMarkers}
        />
        {selection && (
          <Marker
            position={[selection.latitude, selection.longitude]}
            draggable={selectable}
            icon={statusMarkerIcon("Pending")}
            eventHandlers={{
              dragend(event) {
                if (!selectable) return;
                const position = event.target.getLatLng();
                onSelect({
                  latitude: position.lat,
                  longitude: position.lng,
                });
              },
            }}
          >
            <Popup>Selected complaint location</Popup>
          </Marker>
        )}
        {validMarkers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.latitude, marker.longitude]}
            icon={statusMarkerIcon(marker.status)}
          >
            <Popup>
              <div className="complaint-map-popup">
                <strong>{marker.id}</strong>
                <span>{marker.title}</span>
                <span>{marker.category}</span>
                <span>{marker.location}</span>
                <span className="complaint-map-popup-status">{marker.status}</span>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
