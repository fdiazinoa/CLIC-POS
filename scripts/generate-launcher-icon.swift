import Foundation
import CoreGraphics
import ImageIO
let root=CommandLine.arguments[1]
func render(_ size:Int,_ foreground:Bool,_ round:Bool,_ output:String) {
 let ctx=CGContext(data:nil,width:size,height:size,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
 ctx.scaleBy(x:CGFloat(size)/108,y:CGFloat(size)/108);ctx.translateBy(x:0,y:108);ctx.scaleBy(x:1,y:-1)
 let navy=CGColor(red:0.02,green:0.055,blue:0.20,alpha:1),cyan=CGColor(red:0,green:0.86,blue:0.91,alpha:1)
 if !foreground {ctx.setFillColor(navy);ctx.addPath(CGPath(roundedRect:CGRect(x:0,y:0,width:108,height:108),cornerWidth:round ? 54:23,cornerHeight:round ? 54:23,transform:nil));ctx.fillPath();ctx.translateBy(x:54,y:54);ctx.scaleBy(x:1.22,y:1.22);ctx.translateBy(x:-54,y:-54)}
 ctx.setStrokeColor(cyan);ctx.setLineWidth(5);ctx.setLineCap(.round)
 let handle=CGMutablePath();handle.move(to:CGPoint(x:43,y:39));handle.addLine(to:CGPoint(x:43,y:33));handle.addCurve(to:CGPoint(x:65,y:33),control1:CGPoint(x:43,y:18),control2:CGPoint(x:65,y:18));handle.addLine(to:CGPoint(x:65,y:39));ctx.addPath(handle);ctx.strokePath()
 let bag=CGMutablePath();bag.move(to:CGPoint(x:36,y:37));bag.addLine(to:CGPoint(x:72,y:37));bag.addQuadCurve(to:CGPoint(x:77,y:42),control:CGPoint(x:77,y:37));bag.addLine(to:CGPoint(x:80,y:76));bag.addQuadCurve(to:CGPoint(x:74,y:82),control:CGPoint(x:81,y:82));bag.addLine(to:CGPoint(x:34,y:82));bag.addQuadCurve(to:CGPoint(x:28,y:76),control:CGPoint(x:27,y:82));bag.addLine(to:CGPoint(x:31,y:42));bag.addQuadCurve(to:CGPoint(x:36,y:37),control:CGPoint(x:31,y:37));bag.closeSubpath();ctx.setFillColor(cyan);ctx.addPath(bag);ctx.fillPath()
 ctx.setStrokeColor(navy);ctx.setLineWidth(5.5);ctx.setLineJoin(.round);ctx.move(to:CGPoint(x:43,y:60));ctx.addLine(to:CGPoint(x:51,y:68));ctx.addLine(to:CGPoint(x:66,y:53));ctx.strokePath()
 let dest=CGImageDestinationCreateWithURL(URL(fileURLWithPath:output) as CFURL,"public.png" as CFString,1,nil)!;CGImageDestinationAddImage(dest,ctx.makeImage()!,nil);CGImageDestinationFinalize(dest)
}
for (density,size) in [("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)] {
 let d="\(root)/android/app/src/main/res/mipmap-\(density)"
 render(size,false,false,"\(d)/ic_launcher.png");render(size,false,true,"\(d)/ic_launcher_round.png");render(size*108/48,true,false,"\(d)/ic_launcher_foreground.png")
}
render(512,false,false,"\(root)/assets/branding/clic-pos-launcher.png")
