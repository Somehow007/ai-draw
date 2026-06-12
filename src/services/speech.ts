class SpeechRecognitionService {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;

  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      this.recognition = new SR();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'zh-CN';
    }
  }

  onResult(
    onInterim: (text: string) => void,
    onFinal: (text: string) => void,
  ) {
    if (!this.recognition) return;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (interim) onInterim(interim);
      if (final) onFinal(final.trim());
    };
  }

  onError(handler: (error: string) => void) {
    if (!this.recognition) return;
    this.recognition.onerror = (event) => handler(event.error);
  }

  onEnd(handler: () => void) {
    if (!this.recognition) return;
    this.recognition.onend = () => {
      this.isListening = false;
      handler();
    };
  }

  onStart(handler: () => void) {
    if (!this.recognition) return;
    this.recognition.onstart = handler;
  }

  start() {
    if (!this.recognition || this.isListening) return;
    try {
      this.recognition.start();
      this.isListening = true;
    } catch {
      // Already started
    }
  }

  stop() {
    if (!this.recognition || !this.isListening) return;
    this.recognition.stop();
    this.isListening = false;
  }

  get supported() {
    return this.recognition !== null;
  }

  get listening() {
    return this.isListening;
  }
}

export const speechService = new SpeechRecognitionService();
