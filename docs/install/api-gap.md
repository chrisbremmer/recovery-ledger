<!-- Generated from src/domain/api-gap/catalog.ts — do not hand-edit. -->
<!-- Run `npm run docs:generate-api-gap` after changing the source.   -->

# WHOOP API v2 Gap

WHOOP consumer-app features that are NOT exposed via the public v2 API.

## Healthspan

**WHOOP app path:** WHOOP app → Health Monitor → Healthspan

**Available via v2 API:** No.

**Closest v2 alternative:** closest proxy: long-run trends in recovery_score

WHOOP-only composite score combining recovery, strain, sleep, and other inputs. Not exposed on the public v2 API.

## ECG (electrocardiogram)

**WHOOP app path:** WHOOP app → Heart → ECG

**Available via v2 API:** No.

**Closest v2 alternative:** None.

Single-lead ECG capture for atrial-fibrillation detection. Raw waveforms are not exposed on the v2 API.

## Blood Pressure

**WHOOP app path:** WHOOP app → Heart → Blood Pressure

**Available via v2 API:** No.

**Closest v2 alternative:** None.

Cuffless blood-pressure estimation. Not exposed on the v2 API.

## Journal

**WHOOP app path:** WHOOP app → Journal

**Available via v2 API:** No.

**Closest v2 alternative:** None.

Daily lifestyle-factor logging (alcohol, caffeine, etc.). Not exposed on the v2 API.

## Continuous Heart Rate

**WHOOP app path:** WHOOP app → Heart → Continuous HR

**Available via v2 API:** No.

**Closest v2 alternative:** closest proxy: cycle.day_strain reflects HR-derived load over the day

Second-by-second heart-rate stream. The v2 API exposes summary fields per cycle but not the raw stream.

## Hormonal Insights

**WHOOP app path:** WHOOP app → Health Monitor → Hormonal Insights

**Available via v2 API:** No.

**Closest v2 alternative:** None.

Menstrual-cycle phase tracking with strain/recovery overlays. Not exposed on the v2 API.
