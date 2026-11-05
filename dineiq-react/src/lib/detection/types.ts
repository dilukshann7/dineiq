export type Detection = {
  label: string;
  confidence: number;
  box: [number, number, number, number];
  polygon?: [number, number][];
};

export type DetectionResult = {
  width: number;
  height: number;
  detections: Detection[];
};
