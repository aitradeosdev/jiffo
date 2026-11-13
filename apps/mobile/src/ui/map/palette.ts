/** Map colours from the prototypes, light and dark. */
export const MAP_COLORS = {
  light: {
    land: '#EDEFF1',
    building: '#E0E3E7',
    park: '#DCEDE0',
    water: '#AFD4F3',
    road: '#FFFFFF',
    roadEdge: '#DFE2E6',
    primary: '#FFFFFF',
    primaryEdge: '#D2D6DB',
    motor: '#FFFFFF',
    motorEdge: '#C9CED4',
    label: '#6E7378',
    halo: '#FFFFFF',
    route: '#000000',
    routeEdge: '#FFFFFF',
  },
  dark: {
    land: '#1B1D20',
    building: '#24272B',
    park: '#1A2A20',
    water: '#0D1A27',
    road: '#2E3236',
    roadEdge: '#1E2124',
    primary: '#3A3F44',
    primaryEdge: '#25292C',
    motor: '#464C52',
    motorEdge: '#2B3034',
    label: '#8E949A',
    halo: '#1B1D20',
    route: '#FFFFFF',
    routeEdge: '#000000',
  },
};

export type MapColors = (typeof MAP_COLORS)['light'];

/** A Google Maps style built from the same colours, so Android's map looks like the prototype's. */
export function googleStyle(m: MapColors) {
  return [
    { elementType: 'geometry', stylers: [{ color: m.land }] },
    { elementType: 'labels.text.fill', stylers: [{ color: m.label }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: m.halo }] },
    { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: m.park }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: m.building }] },
    { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: m.road }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: m.roadEdge }] },
    { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: m.primary }] },
    { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: m.primaryEdge }] },
    { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: m.motor }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: m.motorEdge }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: m.water }] },
  ];
}
