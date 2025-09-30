export const config = {
    runtime: "edge",
};

export default async function handler(req) {
    const { searchParams } = new URL(req.url);

    const url = searchParams.get("url");
    if (!url) {
        return new Response("Missing ?url= parameter", { status: 400 });
    }

    try {
        // Fetch from Dropbox
        const response = await fetch(url);

        // Pass headers + body back to the client
        return new Response(response.body, {
            status: response.status,
            headers: {
                "Content-Type": response.headers.get("content-type") || "application/octet-stream",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (err) {
        return new Response("Error fetching: " + err.message, { status: 500 });
    }
}
