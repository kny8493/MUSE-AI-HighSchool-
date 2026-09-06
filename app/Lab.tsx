'use client';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Camera,
  MousePointer2,
  Download,
  ArrowUpRight,
  NotebookPen,
  Check,
  CircleHelp,
  Flag,
  ScanLine,
  ChevronRight,
  MoveHorizontal,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PRESETS,
  clamp,
  height,
  step,
  metrics,
  freshBall,
  poseInput,
  type Ball,
} from '@/lib/physics';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';

const lessons = [
  {
    title: '언덕과 공의 운동',
    short: '물리 탐구',
    question: '언덕의 높이가 달라지면 공은 어떻게 움직일까?',
    steps: [
      '출발 언덕의 높이만 바꾸어 보세요.',
      '같은 지점을 지날 때 속력을 비교하세요.',
      '관찰한 변화를 에너지와 연결해 설명하세요.',
    ],
    prompt: '출발 높이를 바꿨을 때 무엇이 달라졌나요?',
  },
  {
    title: '몸으로 바꾸는 지형',
    short: 'AI 체험',
    question: 'AI는 내 몸의 어떤 정보를 화면에 전달할까?',
    steps: [
      '몸동작 모드에서 카메라를 켜세요.',
      '담당 언덕을 선택하고 몸을 천천히 낮추거나 높이세요.',
      '좌우로 옮겨 보고 카메라 아래 위치 표시를 살펴보세요.',
    ],
    prompt: '잘 인식된 조건과 인식이 끊긴 조건을 비교해 보세요.',
  },
  {
    title: '골까지 보내는 전략',
    short: '전략 실험',
    question: '어느 언덕을 언제 바꿔야 공이 골에 도착할까?',
    steps: [
      '도전 지형을 불러오고 이동 전략을 정하세요.',
      '언덕을 맡아 마우스 또는 몸동작으로 조절하세요.',
      '다시 시험하고 근거를 바탕으로 전략을 수정하세요.',
    ],
    prompt: '우리 모둠의 전략과 그 전략을 바꾼 근거는 무엇인가요?',
  },
  {
    title: '나래관에서 확인하기',
    short: '현장 체험',
    question: '웹에서 세운 예상은 실제 전시에서도 맞을까?',
    steps: [
      '1~4명씩 체험 구역과 안내 수칙을 확인하세요.',
      '위치 변화 → 언덕 변화 → 공의 움직임을 관찰하세요.',
      '웹 실습과 같은 점, 다른 점을 기록하세요.',
    ],
    prompt: '직접 확인한 사실과 아직 확인하지 못한 점을 구분해 보세요.',
  },
];
const colors = ['#c4b5fd', '#f472b6', '#fbbf24', '#5eead4'];
type Entry = {
  at: string;
  lesson: number;
  levels: number[];
  speed: number;
  h: number;
  time: number;
  mode: string;
};
type Notes = { group: string; prediction: string[]; result: string[] };
function readSaved() {
  const fallback = {
    notes: {
      group: '',
      prediction: ['', '', '', ''],
      result: ['', '', '', ''],
    },
    records: [] as Entry[],
  };
  try {
    const raw = localStorage.getItem('muse-ai-lab-v1');
    if (!raw) return fallback;
    const d = JSON.parse(raw);
    if (
      d.notes &&
      typeof d.notes.group === 'string' &&
      ['prediction', 'result'].every(
        (k) =>
          Array.isArray(d.notes[k]) &&
          d.notes[k].length === 4 &&
          d.notes[k].every((v: unknown) => typeof v === 'string'),
      )
    )
      fallback.notes = d.notes;
    if (Array.isArray(d.records))
      fallback.records = d.records
        .filter(
          (r: Entry) =>
            r &&
            Array.isArray(r.levels) &&
            r.levels.length === 4 &&
            r.levels.every(Number.isFinite) &&
            [r.speed, r.h, r.time, r.lesson].every(Number.isFinite),
        )
        .slice(-30);
  } catch {
    /* An unavailable or invalid local record starts a fresh worksheet. */
  }
  return fallback;
}
export default function Lab() {
  const [initial] = useState(readSaved);
  const [lesson, setLesson] = useState(0),
    [levels, setLevels] = useState<number[]>([...PRESETS.slope]),
    [running, setRunning] = useState(false),
    [mode, setMode] = useState('mouse'),
    [selected, setSelected] = useState(0),
    [friction, setFriction] = useState(0);
  const [display, setDisplay] = useState({
    ...metrics(freshBall(), PRESETS.slope),
    time: 0,
    won: false,
  });
  const [notes, setNotes] = useState<Notes>(initial.notes),
    [records, setRecords] = useState<Entry[]>(initial.records),
    [saved, setSaved] = useState('기록은 이 기기에 저장됩니다');
  const [cameraOn, setCameraOn] = useState(false),
    [busy, setBusy] = useState(false),
    [cameraStatus, setCameraStatus] = useState('카메라 꺼짐'),
    [position, setPosition] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    video = useRef<HTMLVideoElement>(null),
    ball = useRef<Ball>(freshBall()),
    drag = useRef<number | null>(null);
  const live = useRef({ levels, running, friction, selected });
  useLayoutEffect(() => {
    live.current = { levels, running, friction, selected };
  }, [levels, running, friction, selected]);
  const detector = useRef<PoseLandmarker | null>(null),
    stream = useRef<MediaStream | null>(null),
    cameraFrame = useRef(0),
    generation = useRef(0);
  const current = lessons[lesson];
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          'muse-ai-lab-v1',
          JSON.stringify({ notes, records }),
        );
        setSaved('이 기기에 자동 저장됨');
      } catch {
        setSaved('자동 저장 불가 · 기록 내려받기를 이용하세요');
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [notes, records]);
  const stopCamera = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(cameraFrame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    detector.current?.close();
    detector.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraOn(false);
    setBusy(false);
    setPosition(null);
    setCameraStatus('카메라 꺼짐');
  }, []);
  useEffect(
    () => () => {
      generation.current++;
      cancelAnimationFrame(cameraFrame.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      detector.current?.close();
    },
    [],
  );
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        stopCamera();
        setRunning(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [stopCamera]);
  function changeLevel(i: number, v: number) {
    setLevels((prev) => prev.map((n, k) => (k === i ? clamp(v, 0, 100) : n)));
  }
  function reset() {
    ball.current = freshBall();
    setRunning(false);
    setDisplay({ ...metrics(ball.current, levels), time: 0, won: false });
  }
  function preset(name: keyof typeof PRESETS) {
    setLevels([...PRESETS[name]]);
    ball.current = freshBall();
    setRunning(false);
  }
  function changeLesson(n: number) {
    setLesson(n);
    reset();
    if (n === 2) preset('challenge');
    if (n === 3) {
      stopCamera();
      setMode('mouse');
    }
  }
  useEffect(() => {
    let frame = 0,
      previous = 0,
      elapsed = 0,
      report = 0;
    function render(now: number) {
      const c = canvas.current,
        ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      const { levels: l, running: run, friction: f } = live.current;
      if (run && !ball.current.won) {
        elapsed += delta;
        while (elapsed >= 1 / 120) {
          ball.current = step(ball.current, l, 1 / 120, f);
          elapsed -= 1 / 120;
        }
        if (ball.current.won) setRunning(false);
      } else elapsed = 0;
      const rect = c.getBoundingClientRect(),
        dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (
        c.width !== Math.round(rect.width * dpr) ||
        c.height !== Math.round(rect.height * dpr)
      ) {
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(c.width / 1000, 0, 0, c.height / 460, 0, 0);
      ctx.clearRect(0, 0, 1000, 460);
      ctx.strokeStyle = '#ffffff09';
      ctx.lineWidth = 1;
      for (let x = 0; x <= 1000; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 460);
        ctx.stroke();
      }
      for (let y = 10; y < 460; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1000, y);
        ctx.stroke();
      }
      const yAt = (x: number) => 430 - height(x, l),
        g = ctx.createLinearGradient(0, 0, 1000, 0);
      g.addColorStop(0, '#8b5cf67a');
      g.addColorStop(0.38, '#ec48996b');
      g.addColorStop(0.7, '#f59e0b58');
      g.addColorStop(1, '#14b8a649');
      ctx.beginPath();
      ctx.moveTo(0, 460);
      for (let x = 0; x <= 1000; x += 2) ctx.lineTo(x, yAt(x));
      ctx.lineTo(1000, 460);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      for (let x = 0; x <= 1000; x += 2) {
        if (x === 0) ctx.moveTo(x, yAt(x));
        else ctx.lineTo(x, yAt(x));
      }
      ctx.strokeStyle = '#e2d9ff';
      ctx.lineWidth = 3;
      ctx.stroke();
      [0, 300, 600, 900].forEach((x, i) => {
        const px = clamp(x, 22, 970),
          py = yAt(x);
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = colors[i] + '80';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + 16);
        ctx.lineTo(px, 438);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, py, live.current.selected === i ? 13 : 10, 0, Math.PI * 2);
        ctx.fillStyle = '#161a35';
        ctx.fill();
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = colors[i];
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), px, py + 5);
      });
      const gy = yAt(965);
      ctx.fillStyle = '#5eead41c';
      ctx.fillRect(935, gy - 95, 60, 95);
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(965, gy - 6);
      ctx.lineTo(965, gy - 85);
      ctx.stroke();
      ctx.fillStyle = '#5eead4';
      ctx.beginPath();
      ctx.moveTo(965, gy - 85);
      ctx.lineTo(992, gy - 74);
      ctx.lineTo(965, gy - 62);
      ctx.fill();
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('GOAL', 989, gy - 103);
      const b = ball.current,
        by = yAt(b.x) - 13;
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(b.x, by, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(b.x - 3, by - 3, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#c4b5fd';
      ctx.fill();
      if (now - report > 100) {
        setDisplay({ ...metrics(b, l), time: b.time, won: b.won });
        report = now;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);
  async function startCamera() {
    if (busy || cameraOn) return;
    const token = ++generation.current;
    setBusy(true);
    setCameraStatus('카메라와 AI 준비 중…');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'HTTPS 주소 또는 localhost에서 카메라를 사용할 수 있어요.',
        );
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      if (token !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const { FilesetResolver, PoseLandmarker: Pose } =
        await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
      );
      const model = await Pose.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      if (token !== generation.current) {
        model.close();
        return;
      }
      detector.current = model;
      const el = video.current;
      if (!el) throw new Error('카메라 화면을 다시 열어 주세요.');
      el.srcObject = media;
      await el.play();
      if (token !== generation.current) return;
      setCameraOn(true);
      setBusy(false);
      let last = 0,
        lastVideo = -1;
      const detect = (time: number) => {
        if (token !== generation.current) return;
        try {
          if (
            el.readyState >= 2 &&
            time - last > 90 &&
            el.currentTime !== lastVideo
          ) {
            last = time;
            lastVideo = el.currentTime;
            const result = model.detectForVideo(el, time),
              input = result.landmarks[0]
                ? poseInput(result.landmarks[0])
                : null;
            if (input) {
              setPosition(input.x);
              setCameraStatus('어깨 위치 인식 중');
              setLevels((prev) =>
                prev.map((v, i) =>
                  i === live.current.selected ? v * 0.8 + input.level * 0.2 : v,
                ),
              );
            } else {
              setPosition(null);
              setCameraStatus('양쪽 어깨가 보이도록 서 주세요 · 지형 유지');
            }
          }
          cameraFrame.current = requestAnimationFrame(detect);
        } catch {
          stopCamera();
          setCameraStatus(
            '인식이 중단됐어요. 다시 켜거나 마우스로 실습하세요.',
          );
        }
      };
      cameraFrame.current = requestAnimationFrame(detect);
    } catch (error) {
      if (token !== generation.current) return;
      stopCamera();
      const name = (error as Error).name;
      setCameraStatus(
        name === 'NotAllowedError'
          ? '카메라 권한이 필요해요. 주소창에서 허용 후 다시 켜 주세요.'
          : name === 'NotFoundError'
            ? '카메라를 찾지 못했어요. 마우스로 실습할 수 있습니다.'
            : `준비하지 못했어요. ${(error as Error).message} 네트워크와 카메라를 확인해 주세요.`,
      );
    }
  }
  function record() {
    const m = metrics(ball.current, levels);
    setRecords((prev) =>
      [
        ...prev,
        {
          at: new Date().toLocaleTimeString('ko-KR'),
          lesson: lesson + 1,
          levels: levels.map(Math.round),
          speed: +m.speed.toFixed(2),
          h: +m.h.toFixed(2),
          time: +ball.current.time.toFixed(1),
          mode: mode === 'mouse' ? '마우스' : '몸동작',
        },
      ].slice(-30),
    );
  }
  function updateNote(key: 'prediction' | 'result', value: string) {
    setNotes((prev) => ({
      ...prev,
      [key]: prev[key].map((s, i) => (i === lesson ? value : s)),
    }));
  }
  function download() {
    const text = [
      'MUSE-AI 연구회 | 디지털 물리 탐구실',
      `모둠: ${notes.group || '미입력'}`,
      ...lessons.flatMap((l, i) => [
        `\n${i + 1}차시 ${l.title}`,
        `예상과 계획: ${notes.prediction[i]}`,
        `관찰과 해석: ${notes.result[i]}`,
      ]),
      '\n실험 기록',
      ...records.map(
        (r, i) =>
          `${i + 1}. ${r.lesson}차시 ${r.at} | ${r.mode} | 언덕 ${r.levels.join('/')}% | 속력 ${r.speed}m/s | 높이 ${r.h}m | ${r.time}s`,
      ),
      '\n수치는 1kg 점질량과 9.8m/s² 중력의 교육용 모형 값이며 전시물의 측정값이 아닙니다.',
    ].join('\n');
    const url = URL.createObjectURL(
        new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = 'MUSE-AI_탐구기록.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const total = display.potential + display.kinetic;
  return (
    <div className="lab-shell">
      <a className="skip-link" href="#experiment">
        실습으로 건너뛰기
      </a>
      <header className="site-header">
        <a href="./" className="brand">
          <span className="brand-mark">
            M<span>✳</span>
          </span>
          <div>
            <strong>MUSE-AI</strong>
            <small>과학관 AI 교육 교사연구회</small>
          </div>
        </a>
        <div className="header-title">
          디지털 물리 탐구실 <span>HIGH SCHOOL LAB</span>
        </div>
        <button className="outline-button" onClick={download}>
          <Download size={16} /> 기록 내려받기
        </button>
      </header>
      <main>
        <div className="intro-row">
          <div>
            <span className="eyebrow">MOVE · OBSERVE · DISCOVER</span>
            <h1>움직임이 만드는 물리</h1>
          </div>
          <p>
            교실에서 실험하고,
            <br />
            나래관에서 발견하세요.
            <ArrowUpRight size={24} />
          </p>
        </div>
        <Tabs
          value={lesson}
          onValueChange={(v) => changeLesson(Number(v))}
          className="lesson-tabs"
        >
          <TabsList className="lesson-list">
            {lessons.map((l, i) => (
              <TabsTrigger key={l.short} value={i} className="lesson-tab">
                <span className="lesson-number">0{i + 1}</span>
                <span>
                  {l.short}
                  <small>{i === 3 ? '현장에서' : '교실에서'}</small>
                </span>
                {i < 3 && <ChevronRight size={17} className="step-arrow" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="workspace">
          <section
            className="experiment"
            id="experiment"
            aria-label="디지털 물리 실험"
          >
            <div className="experiment-heading">
              <div>
                <span className="live-dot" /> INTERACTIVE LAB
              </div>
              <span>중력 9.8 m/s² · 질량 1 kg</span>
            </div>
            <div className="mode-row">
              <Tabs
                value={mode}
                onValueChange={(v) => {
                  setMode(String(v));
                  if (v === 'mouse') stopCamera();
                }}
              >
                <TabsList className="mode-list">
                  <TabsTrigger value="mouse">
                    <MousePointer2 size={15} /> 마우스
                  </TabsTrigger>
                  <TabsTrigger value="body">
                    <Camera size={15} /> 몸동작 AI
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="stage-instruction">
                {mode === 'mouse'
                  ? '번호점을 위아래로 끌어 보세요'
                  : '선택한 언덕을 몸의 높이로 조절하세요'}
              </span>
            </div>
            <div className="canvas-wrap">
              <canvas
                ref={canvas}
                aria-label="언덕 위 공의 운동. 아래 슬라이더로 동일하게 조작할 수 있습니다."
                onPointerDown={(e) => {
                  if (mode !== 'mouse') return;
                  const r = e.currentTarget.getBoundingClientRect(),
                    x = ((e.clientX - r.left) / r.width) * 1000;
                  drag.current = [0, 300, 600, 900].reduce(
                    (a, v, i) =>
                      Math.abs(v - x) < Math.abs([0, 300, 600, 900][a] - x)
                        ? i
                        : a,
                    0,
                  );
                  setSelected(drag.current);
                  e.currentTarget.setPointerCapture(e.pointerId);
                  changeLevel(
                    drag.current,
                    (430 - ((e.clientY - r.top) / r.height) * 460 - 70) / 2.8,
                  );
                }}
                onPointerMove={(e) => {
                  if (drag.current === null) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  changeLevel(
                    drag.current,
                    (430 - ((e.clientY - r.top) / r.height) * 460 - 70) / 2.8,
                  );
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
              />
              {display.won && (
                <output className="win-banner">
                  <Flag size={20} />
                  <strong>골에 도착했어요!</strong>
                  <span>어떤 변화가 도움이 되었나요?</span>
                </output>
              )}
            </div>
            <div className="playback">
              <button
                className="play-button"
                onClick={() => {
                  if (display.won) {
                    ball.current = freshBall();
                    setRunning(true);
                  } else setRunning((r) => !r);
                }}
              >
                {running ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
                {running
                  ? '일시 정지'
                  : display.won
                    ? '다시 굴리기'
                    : display.time
                      ? '이어서 실행'
                      : '공 굴리기'}
              </button>
              <button
                className="icon-button"
                aria-label="공을 출발점으로 되돌리기"
                onClick={reset}
              >
                <RotateCcw size={18} />
              </button>
              <span className="timer">
                {display.time.toFixed(1)} <small>s</small>
              </span>
              <button className="capture-button" onClick={record}>
                <NotebookPen size={16} /> 현재 값 기록
              </button>
            </div>
            <div className="measurements">
              <div>
                <small>공의 속력</small>
                <strong>
                  {display.speed.toFixed(2)} <span>m/s</span>
                </strong>
              </div>
              <div>
                <small>공의 높이</small>
                <strong>
                  {display.h.toFixed(2)} <span>m</span>
                </strong>
              </div>
              <div className="energy">
                <small>
                  에너지{' '}
                  <span>
                    위치 <b className="purple-key" /> 운동{' '}
                    <b className="mint-key" />
                  </span>
                </small>
                <div className="energy-bar">
                  <span
                    style={{
                      width: `${total ? (display.potential / total) * 100 : 100}%`,
                    }}
                  />
                  <span
                    style={{
                      width: `${total ? (display.kinetic / total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p>
                  {display.potential.toFixed(1)} J{' '}
                  <span>{display.kinetic.toFixed(1)} J</span>
                </p>
              </div>
            </div>
            <div className="terrain-controls">
              <div className="section-heading">
                <h2>언덕 조절</h2>
                <div className="presets">
                  <button onClick={() => preset('slope')}>내리막</button>
                  <button onClick={() => preset('valley')}>골짜기</button>
                  <button onClick={() => preset('challenge')}>도전 지형</button>
                </div>
              </div>
              <div className="sliders">
                {levels.map((n, i) => (
                  <div
                    className={`hill-control ${selected === i ? 'selected' : ''}`}
                    key={i}
                    style={{ '--hill': colors[i] } as React.CSSProperties}
                  >
                    <button
                      onClick={() => setSelected(i)}
                      aria-pressed={selected === i}
                    >
                      <span>{i + 1}</span>{' '}
                      {i === 0
                        ? '출발 언덕'
                        : i === 3
                          ? '골 앞 언덕'
                          : `중간 언덕 ${i}`}
                      <b>
                        {Math.round(n)}
                        <small>%</small>
                      </b>
                    </button>
                    <Slider
                      value={[n]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) =>
                        changeLevel(i, Array.isArray(v) ? v[0] : v)
                      }
                      aria-label={`${i + 1}번 언덕 높이`}
                    />
                  </div>
                ))}
              </div>
              <div className="friction-row">
                <span>마찰</span>
                <button
                  className={friction === 0 ? 'chosen' : ''}
                  aria-pressed={friction === 0}
                  onClick={() => setFriction(0)}
                >
                  없음
                </button>
                <button
                  className={friction !== 0 ? 'chosen' : ''}
                  aria-pressed={friction !== 0}
                  onClick={() => setFriction(0.35)}
                >
                  있음
                </button>
                <p>움직이는 지형은 공에 에너지를 더하거나 뺄 수 있어요.</p>
              </div>
            </div>
            {mode === 'body' && (
              <div className="camera-section">
                <div className="video-box">
                  <video ref={video} muted playsInline />
                  {!cameraOn && <ScanLine size={32} />}
                  <div className="position-track">
                    {position !== null && (
                      <span style={{ left: `${position * 100}%` }} />
                    )}
                  </div>
                </div>
                <div>
                  <h3>
                    내가 맡은 언덕 <b>{selected + 1}번</b>
                  </h3>
                  <p>
                    양쪽 어깨가 보이도록 서서 몸을 낮추거나 높여 보세요. 좌우
                    위치는 아래 점으로 확인합니다.
                  </p>
                  <button
                    className="outline-button"
                    onClick={cameraOn || busy ? stopCamera : startCamera}
                  >
                    {busy
                      ? '준비 취소'
                      : cameraOn
                        ? '카메라 끄기'
                        : '카메라 켜기'}
                  </button>
                  <output className="camera-status">{cameraStatus}</output>
                  <small>
                    영상은 기기 안에서 처리하며 서버에 저장하지 않습니다. 최초
                    AI 로딩에는 인터넷이 필요합니다.
                  </small>
                </div>
              </div>
            )}
          </section>
          <aside className="learning-panel">
            <div className="lesson-meta">
              <span>LESSON 0{lesson + 1}</span>
              <small>
                {lesson === 3 ? '창의나래관 · 현장' : '교실 · 50분'}
              </small>
            </div>
            <h2>{current.title}</h2>
            <p className="inquiry">{current.question}</p>
            <ol className="activity-steps">
              {current.steps.map((s, i) => (
                <li key={s}>
                  <span>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <div className="divider" />
            <div className="notes-title">
              <NotebookPen size={19} />
              <h3>우리 모둠의 탐구 기록</h3>
            </div>
            <label className="group-label">
              모둠 이름
              <input
                value={notes.group}
                onChange={(e) =>
                  setNotes((n) => ({ ...n, group: e.target.value }))
                }
                placeholder="예: 1모둠"
                maxLength={60}
              />
            </label>
            <label>
              예상과 계획
              <textarea
                value={notes.prediction[lesson]}
                onChange={(e) => updateNote('prediction', e.target.value)}
                placeholder={
                  lesson === 3
                    ? '현장에서 확인하고 싶은 질문은?'
                    : '무엇을 바꾸면 어떤 일이 일어날까요?'
                }
                maxLength={4000}
              />
            </label>
            <label>
              관찰과 해석
              <textarea
                value={notes.result[lesson]}
                onChange={(e) => updateNote('result', e.target.value)}
                placeholder={current.prompt}
                maxLength={4000}
              />
            </label>
            <p className="save-status">
              <Check size={13} />
              {saved}
            </p>
            <div className="lesson-tip">
              <CircleHelp size={18} />
              <p>
                {lesson === 3
                  ? '전시물의 AI 사용 여부는 관찰만으로 단정하지 말고 담당자에게 확인해 보세요.'
                  : '지형을 고정한 실험과 움직이는 실험을 구분하세요. 이 공은 굴림 회전을 생략한 교육용 모형입니다.'}
              </p>
            </div>
          </aside>
        </div>
        <section className="records-section">
          <div className="section-heading">
            <div>
              <h2>
                실험 기록 <span>{records.length}</span>
              </h2>
              <p>
                비교하고 싶은 순간에 ‘현재 값 기록’을 눌러 보세요. 최근 30개를
                보관합니다.
              </p>
            </div>
            <button className="text-button" onClick={download}>
              <Download size={16} /> 전체 기록 내려받기
            </button>
          </div>
          {records.length ? (
            <div className="record-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>차시</TableHead>
                    <TableHead>시각</TableHead>
                    <TableHead>모드</TableHead>
                    <TableHead>언덕 높이 1 · 2 · 3 · 4</TableHead>
                    <TableHead>속력</TableHead>
                    <TableHead>높이</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.lesson}차시</TableCell>
                      <TableCell>{r.at}</TableCell>
                      <TableCell>{r.mode}</TableCell>
                      <TableCell>{r.levels.join(' / ')} %</TableCell>
                      <TableCell>{r.speed} m/s</TableCell>
                      <TableCell>{r.h} m</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="empty-record">
              <MoveHorizontal size={22} />
              <span>조건을 바꾸고, 같은 지점의 결과를 비교해 보세요.</span>
            </div>
          )}
        </section>
        <details className="teacher-guide">
          <summary>교사용 수업 안내와 모형의 범위</summary>
          <div>
            <p>
              1차시 높이와 운동 탐구 → 2차시 몸동작 AI 체험 → 3차시 협동 전략
              실험 → 4차시 창의나래관 디지털 물리쇼 체험. 교실 수업은 각
              50분입니다. 현장 이동·대기 시간은 별도로 확보하세요.
            </p>
            <p>
              웹캠 모드는 한 명의 양쪽 어깨를 MediaPipe 자세 인식 AI로 추정하고,
              어깨의 화면상 높이를 선택한 언덕에 연결합니다. 위치 인식은 AI,
              언덕 변환과 공의 운동은 정해진 규칙입니다. 현장 전시의
              장치·알고리즘과 동일하지 않습니다. 모둠원은 역할을 번갈아
              맡습니다.
            </p>
            <p>
              마찰 없음과 지형 고정 조건에서 에너지 전환을 비교하세요. 수치
              적분의 작은 오차가 있으며 회전·충돌·공기 저항은 단순화했습니다.
              높이는 모형의 기준선에서 잽니다. 전시물의 측정값이 아닙니다.
            </p>
            <p>
              기록은 이 브라우저에만 저장됩니다. 공용 기기에서는 기록을 내려받고
              브라우저의 사이트 데이터를 지우세요. 카메라가 없어도
              마우스·터치·키보드 슬라이더로 실습할 수 있습니다.
            </p>
            <a
              href="https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js"
              target="_blank"
              rel="noreferrer"
            >
              자세 인식 기술 안내 ↗
            </a>
          </div>
        </details>
      </main>
      <footer>
        <strong>MUSE-AI</strong>
        <span>과학관 AI 교육 교사연구회</span>
        <span>교실의 탐구를 과학관으로.</span>
      </footer>
    </div>
  );
}
