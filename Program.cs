using Mjdalways.SiteStats;
using EstimationStation.Hubs;
using EstimationStation.Services;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;

var builder = WebApplication.CreateBuilder(args);
builder.AddSiteStats(); // anonymous usage stats, report at /admin/stats

// Add services to the container.
builder.Services.AddControllersWithViews();
builder.Services.AddSingleton<ActivityHubFilter>();
builder.Services.AddSignalR(o =>
{
    o.MaximumReceiveMessageSize = 1_048_576; // 1 MB for custom audio broadcast
    o.AddSiteStats();                          // count live calls for /admin/stats
    o.AddFilter<ActivityHubFilter>();          // stamp participant activity for idle sweep
});
builder.Services.AddSingleton<IRoomRepository, FileRoomRepository>();
builder.Services.AddSingleton<RoomService>();
builder.Services.AddSingleton<RoomMediaStore>();
builder.Services.AddSingleton<RoomCreationGuard>();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Per client IP. Uploads and deletes are the expensive calls, so they get a much lower limit than reads.
    o.GlobalLimiter = System.Threading.RateLimiting.PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    {
        var path = ctx.Request.Path;
        var write = !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method);
        int? limit =
            path.StartsWithSegments("/api") ? (write ? 20 : 600) :
            path.StartsWithSegments("/pokerhub") && write ? 120 : null;
        if (limit is null) return System.Threading.RateLimiting.RateLimitPartition.GetNoLimiter("none");
        return System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown") + (write ? ":w" : ":r"),
            _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = limit.Value, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 });
    });
});
builder.Services.AddSingleton<LeaveRequestStore>();
builder.Services.AddHostedService<RoomCleanupService>();
builder.Services.AddHostedService<RoomPersistenceService>();
builder.Services.AddHostedService<ParticipantSweepService>();
builder.Services.AddHttpClient("jira");
builder.Services.AddTransient<JiraService>();
builder.Services.AddSingleton<WordListService>();
builder.Services.AddSingleton<CrosswordGenerator>();
builder.Services.AddSingleton<WordSearchGenerator>();
builder.Services.AddSingleton<SpellingBeeGenerator>();
builder.Services.AddSingleton<JumbleGenerator>();
builder.Services.AddSingleton<ConnectionsGenerator>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

var forwardedOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor
};
forwardedOptions.KnownIPNetworks.Clear();
forwardedOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedOptions);
// The IONOS proxy does not always send X-Forwarded-Proto (seen on phones); every production request is HTTPS.
if (!app.Environment.IsDevelopment())
    app.Use((ctx, next) => { ctx.Request.Scheme = "https"; return next(ctx); });

// On IONOS shared Windows hosting (and similar reverse-proxy environments), SSL is terminated
// at the proxy layer and requests arrive at the app as plain HTTP.  Calling UseHttpsRedirection()
// unconditionally causes an infinite redirect loop because the browser keeps sending HTTPS
// requests that the proxy strips back to HTTP before forwarding.
// We only redirect to HTTPS when the request is NOT coming through a proxy (i.e. no
// X-Forwarded-For / X-Forwarded-Proto headers), which covers direct local development.
// In production the hosting provider's IIS/proxy handles the HTTPS upgrade.
app.UseWhen(
    ctx => !ctx.Request.Headers.ContainsKey("X-Forwarded-For") &&
           !ctx.Request.Headers.ContainsKey("X-Forwarded-Proto"),
    branch => branch.UseHttpsRedirection());
// Anonymous usage stats and the /admin/stats report (Shared\Mjdalways.SiteStats).
// After forwarded headers so the real client is seen, before everything else so every request is counted.
app.UseSiteStats();
app.UseRateLimiter();
app.Use((ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    return next(ctx);
});
app.UseRouting();

app.UseAuthorization();

app.MapStaticAssets();

// Attribute-routed API controllers (e.g. MediaController) aren't reached by the
// conventional MapControllerRoute calls below.
app.MapControllers();

app.MapControllerRoute(
    name: "sitemap",
    pattern: "sitemap.xml",
    defaults: new { controller = "Home", action = "Sitemap" });

app.MapControllerRoute(
    name: "room",
    pattern: "room/{roomName}",
    defaults: new { controller = "Room", action = "Index" });

// F11/P3 — the absentee pre-vote page: a standalone, PIN-gated page that leaves estimates
// in advance WITHOUT joining the room (see PokerHub.PrevoteJoin for why that matters).
app.MapControllerRoute(
    name: "prevote",
    pattern: "room/{roomName}/prevote",
    defaults: new { controller = "Room", action = "Prevote" });

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.MapHub<PokerHub>("/pokerhub");

app.Run();
