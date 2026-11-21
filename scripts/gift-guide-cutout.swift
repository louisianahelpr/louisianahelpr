// Usage: cutout <in1> <out1.png> [<in2> <out2.png> ...]
// Apple Vision foreground mask (the same model as Photos' "Lift subject"), written as a transparent PNG.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = Array(CommandLine.arguments.dropFirst())
let ctx = CIContext()
var i = 0
while i + 1 < args.count {
  let inPath = args[i], outPath = args[i + 1]
  i += 2
  autoreleasepool {
    guard let src = CIImage(contentsOf: URL(fileURLWithPath: inPath)) else { print("FAIL\t\(inPath)\tunreadable"); return }
    let handler = VNImageRequestHandler(ciImage: src)
    let req = VNGenerateForegroundInstanceMaskRequest()
    do {
      try handler.perform([req])
      guard let obs = req.results?.first, !obs.allInstances.isEmpty else { print("FAIL\t\(inPath)\tno subject"); return }
      let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false)
      let img = CIImage(cvPixelBuffer: buf)
      guard let cg = ctx.createCGImage(img, from: img.extent),
            let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)
      else { print("FAIL\t\(inPath)\twrite"); return }
      CGImageDestinationAddImage(dest, cg, nil)
      CGImageDestinationFinalize(dest)
      print("OK\t\(inPath)\t\(obs.allInstances.count)")
    } catch { print("FAIL\t\(inPath)\t\(error)") }
  }
}
