import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBinoculars,
  faCampground,
  faCarSide,
  faCaravan,
  faCompass,
  faCrosshairs,
  faFireFlameCurved,
  faFish,
  faHorse,
  faHouseChimney,
  faMapPin,
  faPersonBiking,
  faPersonHiking,
  faShip,
  faToilet,
  faTruckPickup,
  faUtensils,
  faWater,
  faWheelchair
} from "@fortawesome/free-solid-svg-icons";
import type { FacilityDefinition } from "../lib/api";

const iconByKey: Record<string, IconDefinition> = {
  camping: faCampground,
  walking: faPersonHiking,
  "four-wheel-drive": faTruckPickup,
  cycling: faPersonBiking,
  "horse-riding": faHorse,
  canoeing: faShip,
  waterways: faWater,
  fishing: faFish,
  caravan: faCaravan,
  picnic: faUtensils,
  lookout: faBinoculars,
  adventure: faCompass,
  hunting: faCrosshairs,
  cabin: faHouseChimney,
  fireplace: faFireFlameCurved,
  "two-wheel-drive": faCarSide,
  toilets: faToilet,
  wheelchair: faWheelchair,
  facility: faMapPin
};

const inferIconKey = (facility: FacilityDefinition): string => {
  const joined = `${facility.iconKey} ${facility.label} ${facility.paramName}`.toLowerCase();

  if (/cabin|hut/.test(joined)) {
    return "cabin";
  }

  if (/fireplace|fire pit|fire\b/.test(joined)) {
    return "fireplace";
  }

  if (/2wd|two.?wheel/.test(joined)) {
    return "two-wheel-drive";
  }

  if (/toilet|restroom|bathroom/.test(joined)) {
    return "toilets";
  }

  if (/wheelchair|accessible|accessibilit/.test(joined)) {
    return "wheelchair";
  }

  if (/camp/.test(joined)) {
    return "camping";
  }

  if (/walk/.test(joined)) {
    return "walking";
  }

  if (/4wd|four.?wheel/.test(joined)) {
    return "four-wheel-drive";
  }

  if (/bike|cycling|mountain/.test(joined)) {
    return "cycling";
  }

  if (/horse|riding/.test(joined)) {
    return "horse-riding";
  }

  if (/canoe|kayak|paddle/.test(joined)) {
    return "canoeing";
  }

  if (/water|swim|river|lake/.test(joined)) {
    return "waterways";
  }

  if (/fish/.test(joined)) {
    return "fishing";
  }

  if (/caravan|camper|motorhome/.test(joined)) {
    return "caravan";
  }

  if (/picnic/.test(joined)) {
    return "picnic";
  }

  if (/lookout|view|scenic/.test(joined)) {
    return "lookout";
  }

  if (/adventure/.test(joined)) {
    return "adventure";
  }

  if (/hunting|hunt/.test(joined)) {
    return "hunting";
  }

  return "facility";
};

export const FacilityIcon = ({ facility }: { facility: FacilityDefinition }) => {
  const key = inferIconKey(facility);
  const icon = iconByKey[key] ?? faMapPin;

  return (
    <span className="facility-icon-glyph" aria-label={facility.label}>
      <FontAwesomeIcon icon={icon} fixedWidth />
    </span>
  );
};
