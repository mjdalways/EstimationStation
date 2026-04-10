using EstimationStation.Hubs;
using EstimationStation.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews();
builder.Services.AddSignalR();
builder.Services.AddSingleton<RoomService>();

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
app.UseRouting();

app.UseAuthorization();

app.MapStaticAssets();

app.MapControllerRoute(
    name: "room",
    pattern: "room/{roomName}",
    defaults: new { controller = "Room", action = "Index" });

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}")
    .WithStaticAssets();

app.MapHub<PokerHub>("/pokerhub");

app.Run();
