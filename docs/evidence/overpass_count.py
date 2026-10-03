import json, urllib.request, urllib.parse, time
areas = {"Huye":(-2.5960,29.7390),"Nyamasheke":(-2.3400,29.0900),"Gakenke":(-1.6880,29.7880)}
R=15000
cats = {
 "tourism_any": 'nwr["tourism"]',
 "tourism_attraction_or_viewpoint": 'nwr["tourism"~"^(attraction|viewpoint|museum|artwork|gallery)$"]',
 "tourism_accommodation": 'nwr["tourism"~"^(hotel|guest_house|hostel|motel|camp_site|chalet|apartment)$"]',
 "farm_tourism_tagged": 'nwr["tourism"]["farm"]; nwr["agritourism"]; nwr["tourism"="farm"]; nwr["farm"="tourism"]; nwr["tourism"]["landuse"="farmyard"]',
 "coffee_named_or_tagged": 'nwr["name"~"[Cc]offee|[Cc]afé|[Kk]awa"]; nwr["produce"~"coffee"]; nwr["product"~"coffee"]; nwr["crop"~"coffee"]; nwr["cuisine"="coffee_shop"]',
 "washing_station_named": 'nwr["name"~"[Ww]ashing [Ss]tation|CWS"]',
 "coffee_tour_named": 'nwr["name"~"[Cc]offee.*([Tt]our|[Ee]xperience)|[Tt]our.*[Cc]offee"]; nwr["description"~"[Cc]offee [Tt]our"]',
 "landuse_farmland_or_orchard": 'nwr["landuse"~"^(farmland|orchard|plantation|farmyard)$"]',
}
res={"run_date":"2026-10-03","endpoint":"https://overpass-api.de/api/interpreter","radius_m":R,"areas":{}}
for a,(lat,lon) in areas.items():
  res["areas"][a]={"center":[lat,lon],"counts":{},"names":{}}
  for c,sel in cats.items():
    parts=[s.strip().rstrip(';') for s in sel.split(';') if s.strip()]
    union="".join(f'{p}(around:{R},{lat},{lon});' for p in parts)
    q=f'[out:json][timeout:180];({union});out tags center;'
    for t in range(4):
      try:
        data=urllib.request.urlopen(urllib.request.Request("https://overpass-api.de/api/interpreter",data=urllib.parse.urlencode({"data":q}).encode(),headers={"User-Agent":"echo-hackathon-datasheet/1.0"}),timeout=200).read()
        els=json.loads(data)["elements"]; break
      except Exception as e:
        print("retry",a,c,e,flush=True); time.sleep(20)
    else: els=None
    res["areas"][a]["counts"][c]=None if els is None else len(els)
    res["areas"][a]["names"][c]=None if els is None else sorted({(e.get("tags",{}).get("name","(no name)")+" ["+",".join(f"{k}={v}" for k,v in e.get("tags",{}).items() if k in("tourism","amenity","shop","landuse","man_made","craft","product","produce","farm"))+"]") for e in els})[:60]
    res["areas"][a].setdefault("queries",{})[c]=q
    print(a,c,res["areas"][a]["counts"][c],flush=True); time.sleep(3)
json.dump(res,open("/root/echo/docs/evidence/overpass_result_2026-10-03.json","w"),indent=1,ensure_ascii=False)
print("DONE")
