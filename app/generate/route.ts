import { Ratelimit } from "@upstash/ratelimit";
import redis from "../../utils/redis";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

// Create a new ratelimiter, that allows 5 requests per 24 hours
const ratelimit = redis
  ? new Ratelimit({
      redis: redis,
      limiter: Ratelimit.fixedWindow(5, "1440 m"),
      analytics: true,
    })
  : undefined;

export async function POST(request: Request) {
  // Rate Limiter Code
  if (ratelimit) {
    const headersList = headers();
    const ipIdentifier = headersList.get("x-real-ip");

    const result = await ratelimit.limit(ipIdentifier ?? "");

    if (!result.success) {
      return new Response(
        "Too many uploads in 1 day. Please try again in a 24 hours.",
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": result.limit,
            "X-RateLimit-Remaining": result.remaining,
          } as any,
        }
      );
    }
  }

  const { imageUrl, theme, room } = await request.json();
  const safeTheme = theme || 'default theme'; // Replace 'default theme' with a sensible default
  const safeRoom = room || 'default room';


  // POST request to Replicate to start the image restoration generation process
  let startResponse = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Token " + process.env.REPLICATE_API_KEY,
    },
    body: JSON.stringify({
      version: "854e8727697a057c525cdb45ab037f64ecca770a1769cc52287c2e56472a247b",
      input: {
        image: imageUrl,
        prompt: (() => {
          // Adjusting the prompt to focus more on interior decor aspects of each room
          switch (safeRoom) {
            case "Living Room":
              return `a ${safeTheme.toLowerCase()} living room with a comfortable and stylish sofa, elegant coffee table, ambient lighting, decorative cushions, and wall art.`;
            case "Bedroom":
              return `a serene ${safeTheme.toLowerCase()} bedroom with a plush bed, soft lighting, bedside tables with lamps, a cozy rug, and framed pictures.`;
            case "Kitchen":
              return `a modern ${safeTheme.toLowerCase()} kitchen with sleek cabinetry, energy-efficient appliances, a kitchen island, pendant lights, and bar stools.`;
            case "Bathroom":
              return `a luxurious ${safeTheme.toLowerCase()} bathroom with a walk-in shower, freestanding bathtub, vanity with large mirror, and scented candles.`;
            case "Dining Room":
              return `an inviting ${safeTheme.toLowerCase()} dining room with a large dining table, comfortable chairs, statement lighting, and a sideboard.`;
            case "Home Office":
              return `a functional ${safeTheme.toLowerCase()} home office with a sturdy desk, ergonomic chair, open shelving, task lighting, and motivational posters.`;
            default:
              // A fallback prompt that emphasizes general interior decor and furnishing elements
              return `a tastefully decorated ${safeRoom.toLowerCase()} with attention to color scheme, furniture arrangement, and decorative accessories to enhance the overall ambiance.`;
          }
        })(),
        a_prompt: "best quality, extremely detailed, interior design photo from Pinterest, ultra-detailed, ultra-realistic, award-winning home decor",
        n_prompt: "blurry images, low resolution, bad proportions, missing elements, cluttered spaces, poor lighting",
      },
      
    }),
});

  let jsonStartResponse = await startResponse.json();

  let endpointUrl = jsonStartResponse.urls.get;

  // GET request to get the status of the image restoration process & return the result when it's ready
  let restoredImage: string | null = null;
  while (!restoredImage) {
    // Loop in 1s intervals until the alt text is ready
    console.log("polling for result...");
    let finalResponse = await fetch(endpointUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Token " + process.env.REPLICATE_API_KEY,
      },
    });
    let jsonFinalResponse = await finalResponse.json();

    if (jsonFinalResponse.status === "succeeded") {
      restoredImage = jsonFinalResponse.output;
    } else if (jsonFinalResponse.status === "failed") {
      break;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return NextResponse.json(
    restoredImage ? restoredImage : "Failed to restore image"
  );
}
