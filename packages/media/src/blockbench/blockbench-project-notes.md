# Blockbench Project Notes — `thinner.more-anims.wip`

## Project Info
- **File**: `thinner.more-anims.wip.bbmodel`
- **Format**: Generic Model (Free)
- **Texture Resolution**: 64×64
- **Save Path**: `.../with-extra-root/thinner.more-anims.wip.bbmodel`

## Model Structure
- **Root** → **skeleton-root** → humanoid character
- **26 cubes**, **16 groups**, **0 meshes**
- **3 textures**: `template.png`, `medic-mask.png`, `robot.png`

### Bone Hierarchy
```
skeleton-root
├── hips
│   └── stomach
│       └── chest
│           ├── head
│           ├── rightarm
│           │   └── rightforearm
│           └── leftarm
│               └── leftforearm
├── rightthigh
│   └── rightshin
│       └── rightfoot
└── leftthigh
    └── leftshin
        └── leftfoot
```

## Animations (8 total — all looping)

| Animation | Length | Notes |
|-----------|--------|-------|
| **idle** | 2.5s | Standing/breathing idle |
| **lie** | 4.0s | Lying down pose |
| **run** | 0.75s | Fast movement cycle |
| **shuffle** | 1.0s | Shuffle dance move |
| **shuffle-back** | 1.0s | Shuffle backwards |
| **sit** | 2.5s | Sitting pose |
| **stand** | 2.5s | Standing up pose |
| **walk** | 1.0s | Walking cycle |

### Camera Views
- **Front view**: Camera at (0, 26, -50), looking at (0, 26, 0) — shows face/eyes
- **Back view**: Camera at (0, 26, 50), looking at (0, 26, 0) — shows back of head

### Shuffle Animation Details (Rewritten — was a copy of walk)
The shuffle was originally a copy of the walk animation. It has been rewritten with a bouncy, rhythmic shuffle dance feel.

**Keyframe pattern**: 5 keyframes at 0, 0.25, 0.5, 0.75, 1.0s (linear interpolation)

**Timing pattern**:
- **t=0**: Rest/neutral pose (body settled down)
- **t=0.25**: Peak of first beat (body up, sway right, arms/legs forward)
- **t=0.5**: Rest/neutral (body settled down)
- **t=0.75**: Peak of second beat (body up, sway left, arms/legs backward)
- **t=1**: Back to rest/neutral

| Bone | Channel | t=0 | t=0.25 | t=0.5 | t=0.75 | t=1 | Description |
|------|---------|-----|--------|-------|--------|-----|-------------|
| **skeleton-root** | position | [0,-0.1,0] | [0,0.1,0] | [0,-0.1,0] | [0,0.1,0] | [0,-0.1,0] | Body bounce on each beat |
| **hips** | rotation | [0,0,0] | [0,0,2] | [0,0,0] | [0,0,-2] | [0,0,0] | Side-to-side sway |
| **chest** | rotation | [0,0,0] | [0,0,1] | [0,0,0] | [0,0,-1] | [0,0,0] | Subtle twist |
| **chest** | position | [0,0,0] | [0,0.05,0] | [0,0,0] | [0,0.05,0] | [0,0,0] | Bob with beat |
| **head** | rotation | [0,0,0] | [2,0,0] | [0,0,0] | [-2,0,0] | [0,0,0] | Nodding |
| **head** | position | [0,0,0] | [0,0.05,0] | [0,0,0] | [0,0.05,0] | [0,0,0] | Bob with body |
| **rightarm** | rotation | [0,0,0] | [6,0,4] | [0,0,0] | [-6,0,-4] | [0,0,0] | Big arm swing |
| **rightforearm** | rotation | [0,0,0] | [4,0,0] | [0,0,0] | [-4,0,0] | [0,0,0] | Forearm follow-through |
| **leftarm** | rotation | [0,0,0] | [-6,0,-4] | [0,0,0] | [6,0,4] | [0,0,0] | Opposite arm swing |
| **leftforearm** | rotation | [0,0,0] | [-4,0,0] | [0,0,0] | [4,0,0] | [0,0,0] | Opposite forearm |
| **rightthigh** | rotation | [0,0,0] | [4,0,0] | [0,0,0] | [-4,0,0] | [0,0,0] | Leg lift |
| **rightshin** | rotation | [0,0,0] | [-6,0,0] | [0,0,0] | [-6,0,0] | [0,0,0] | Knee bends backward |
| **rightshin** | position | [0,0,0] | [0,0.05,0] | [0,0,0] | [0,0.05,0] | [0,0,0] | Knee bob |
| **rightfoot** | rotation | [0,0,0] | [4,0,0] | [0,0,0] | [4,0,0] | [0,0,0] | Foot tilt |
| **leftthigh** | rotation | [0,0,0] | [-4,0,0] | [0,0,0] | [4,0,0] | [0,0,0] | Opposite leg lift |
| **leftshin** | rotation | [0,0,0] | [-6,0,0] | [0,0,0] | [-6,0,0] | [0,0,0] | Opposite knee bends backward |
| **leftshin** | position | [0,0,0] | [0,0.05,0] | [0,0,0] | [0,0.05,0] | [0,0,0] | Opposite knee bob |
| **leftfoot** | rotation | [0,0,0] | [4,0,0] | [0,0,0] | [4,0,0] | [0,0,0] | Opposite foot tilt |
