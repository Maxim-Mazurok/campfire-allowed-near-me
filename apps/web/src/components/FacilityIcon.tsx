import {
  IconBinoculars,
  IconCampfire,
  IconCar,
  IconCamper,
  IconCompass,
  IconFish,
  IconHorseToy,
  IconBike,
  IconWalk,
  IconSailboat,
  IconDroplet,
  IconToolsKitchen2,
  IconMapPin,
  IconTarget,
  IconHome,
  IconFlame,
  IconTruck,
  IconToiletPaper,
  IconWheelchair,
  type Icon,
} from "@tabler/icons-react";
import type { FacilityDefinition } from "../lib/api";

const iconByKey: Record<string, Icon> = {
  camping: IconCampfire,
  walking: IconWalk,
  "four-wheel-drive": IconTruck,
  cycling: IconBike,
  "horse-riding": IconHorseToy,
  canoeing: IconSailboat,
  waterways: IconDroplet,
  fishing: IconFish,
  caravan: IconCamper,
  picnic: IconToolsKitchen2,
  lookout: IconBinoculars,
  adventure: IconCompass,
  hunting: IconTarget,
  cabin: IconHome,
  fireplace: IconFlame,
  "two-wheel-drive": IconCar,
  toilets: IconToiletPaper,
  wheelchair: IconWheelchair,
  facility: IconMapPin,
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
  const ResolvedIcon = iconByKey[key] ?? IconMapPin;

  return (
    <span className="facility-icon-glyph" role="img" aria-label={facility.label}>
      <ResolvedIcon size={16} stroke={1.5} />
    </span>
  );
};
