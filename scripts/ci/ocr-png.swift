// Q1008 (11-05): print the text macOS Vision reads in a PNG, one line per observation, so the iOS device check can
// tell the Face ID lock screen from the update gate (run 42003643000 was green on two "Update Helpr to continue" shots).
// Usage: swift scripts/ci/ocr-png.swift <file.png>. Exits 2 when the image cannot be read.
import AppKit
import Vision

let args = CommandLine.arguments
guard args.count == 2, let image = NSImage(contentsOfFile: args[1]),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("ocr-png: cannot read \(args.dropFirst().first ?? "(no file)")\n".data(using: .utf8)!)
  exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
do {
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
  FileHandle.standardError.write("ocr-png: \(error)\n".data(using: .utf8)!)
  exit(2)
}
for obs in request.results ?? [] {
  if let top = obs.topCandidates(1).first { print(top.string) }
}
