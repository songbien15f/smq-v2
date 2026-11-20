# Vùng gió AS/NZS 1170.2:2021 — cái gì kiểm được, cái gì không

Kiểm tra 2026-11-19, bước S2 của plan [quote-tiers-guest-ga2.md](../plans/quote-tiers-guest-ga2.md) (Q3).

## Câu hỏi

Trang Guest cần hiện một dòng như "Region B · 10a Enclosed · Importance Level 2" ngay khi khách
chọn địa chỉ. Phải suy vùng gió từ toạ độ. Vậy:

1. Ranh giới vùng A/B/C/D lấy từ nguồn nào?
2. Tốc độ gió (45 m/s chẳng hạn) in ra được không?

## 1. Ranh giới — có nguồn, nhưng có hai vấn đề

**Nguồn:** Geoscience Australia, *1170.2 Wind Regions for Australia*, một shapefile (ESRI,
GDA2020, `as1170windzones.shp`) mô tả ranh giới vùng gió của AS/NZS 1170.2:2021 Hình 3.1(A).

- <https://data.gov.au/data/dataset/1170-2-wind-regions-for-australia>
- <https://ecat.ga.gov.au/geonetwork/srv/api/records/74dfa021-95cd-4090-9e25-a7a8efde5454>

Bản thân GA ghi rõ ba điều trong metadata:

> "This dataset provides geospatial representation of the Australian wind regions defined in
> AS/NZS 1170.2 (2021)" — và "In the event of any inconsistency between this dataset and Figure 3.1
> in the Standard, the Standard will take precedence".
>
> "...is intended for internal use only", "not suitable for design purposes", và "has not been
> formally endorsed by Standards Australia or the relevant Working Groups and subcommittees".

**Vấn đề 1 — bản quyền.** Trang dữ liệu ghi **"Licence: Not Specified"**. CC BY 4.0 ở chân trang
là giấy phép của *nền tảng data.gov.au*, không phải giấy phép của dataset. Bảng rút gọn trong
`packages/core/src/domain/windRegionData.ts` là **tác phẩm phái sinh** của dataset đó.
**Người dùng cần quyết định** có chấp nhận rủi ro này không; đã ghi vào `docs/KNOWN-DEVIATIONS.md`.

**Vấn đề 2 — không có quy tắc bằng chữ.** Không tìm được nguồn công khai nào nêu "cách bờ biển
100 km" hay "bắc vĩ độ 25°S". Ranh giới chỉ có dạng hình học. Vì vậy cách duy nhất để kiểm là chạy
point-in-polygon trên chính shapefile.

## 2. Đã đo được gì từ shapefile

Dataset có **20 đa giác**, trường `region` là **A0, A1, A2, A3, A4, A5, B1, B2, C, D** — đúng bộ
mã ShedSafe trả về (`A1`, `A2`, `A5`, `B1` đã gặp trong dữ liệu licence cũ). Tổng 1 672 249 đỉnh.

Point-in-polygon tại 20 toạ độ thị trấn (chạy cục bộ, 2026-11-19):

| Điểm | Vĩ độ | Kinh độ | Mã GA | Thư |
|---|---|---|---|---|
| Brisbane CBD | −27.4698 | 153.0251 | B1 (SE Queensland) | B |
| Sydney CBD | −33.8688 | 151.2093 | A2 (NSW) | A |
| Melbourne CBD | −37.8136 | 144.9631 | A5 (Southern coast) | A |
| Perth CBD | −31.9523 | 115.8613 | A1 (Lower west coast) | A |
| Darwin | −12.4634 | 130.8456 | C (Northern coast) | C |
| Cairns | −16.9186 | 145.7781 | C | C |
| Hobart | −42.8821 | 147.3272 | A4 (Tasmania) | A |
| Adelaide | −34.9285 | 138.6007 | A5 | A |
| Alice Springs | −23.6980 | 133.8807 | A0 (Interior) | A |
| Townsville | −19.2589 | 146.8169 | C | C |
| Port Hedland | −20.3107 | 118.6018 | D (Pilbara) | D |
| Toowoomba | −27.5598 | 151.9507 | B1 | B |
| Bundaberg | −24.8661 | 152.3489 | C | C |
| Rockhampton | −23.3791 | 150.5100 | C | C |
| Canberra | −35.2809 | 149.1300 | A3 (NSW) | A |
| Bathurst | −33.4193 | 149.5775 | A3 | A |
| Wagga Wagga | −35.1082 | 147.3598 | A0 | A |
| Ballarat | −37.5622 | 143.8503 | A5 | A |
| Kalgoorlie | −30.7490 | 121.4660 | A0 | A |
| Broken Hill | −31.9505 | 141.4690 | A0 | A |

Đối chiếu với khẳng định "Region B" của khách cho Brisbane: **khớp**.

## 3. Bảng rút gọn đang dùng

`packages/core/src/domain/windRegionData.ts`: 77 vòng, **1 980 đỉnh**, 29 KB.

Cách rút gọn (tái lập được, ghi trong header của file):

1. Gộp mã con về chữ: `A0…A5` → A, `B1`/`B2` → B, `C`, `D`.
2. Douglas–Peucker, dung sai **0.05°** (≈ 5,5 km).
3. Bỏ vòng có diện tích < 0,0001 độ² (≈ 1 km²) — đảo quá nhỏ để chứa một địa chỉ.
4. Làm tròn 2 chữ số thập phân (≈ 1,1 km).

**Đo độ chính xác:**

- 20/20 toạ độ thành phố ở bảng trên cho **cùng chữ** với dataset đầy đủ.
- 4 000 điểm ngẫu nhiên trong phạm vi bản đồ: **97,4 % khớp**. Chỗ lệch nằm sát biên (trong ~10 km).
- 42 thị trấn thật (Geelong, Newcastle, Gold Coast, Mackay, Karratha, Broome, Launceston…):
  **1/42 bị từ chối** (Kununurra, sát biên C).

Vì tỉ lệ lệch nằm ở sát biên, `estimateWindRegion` **từ chối trả lời** khi điểm cách biên giữa hai
vùng chữ khác nhau dưới 0,08° (≈ 8,9 km) — trả `null`, và trang hiện "confirmed in your quote".

## 4. Tốc độ gió — **không in**

Bảng 3.1 của AS/NZS 1170.2 (V_500 theo vùng) nằm sau paywall. Không kiểm được:

- vùng A có đúng 45 m/s hay không;
- "45 m/s" là V_R (tốc độ vùng) hay V_des (tốc độ thiết kế tại điểm, sau hệ số địa hình/cao độ).

Vì vậy `GuestSiteEstimate.windSpeedMs` **không được điền**. Trang hiện vùng và hạng, không hiện
m/s. Đây là đúng luật dừng ở S2 của plan: *"Nếu không có nguồn tin được cho tốc độ, chỉ hiện vùng,
không hiện m/s."*

## 5. Còn chưa kiểm tra

- Bản quyền dataset (xem mục 1).
- Ranh giới vùng D theo chữ của Standard (dataset cho thấy D gồm Pilbara ven biển, khớp với
  những gì ShedSafe từng trả về nhưng đó là suy luận).
- Việc đồng nhất mã GA (`A2`) với mã ShedSafe (`A2`) — **trùng tên, chưa chứng minh là cùng một
  bảng**. Với mục đích của trang Guest (chỉ hiện chữ cái) điều này không ảnh hưởng.

## Tệp đã tải trong lúc nghiên cứu

`ga_windregions.zip` (18,3 MB) và `ga_windspec.pdf` (289 KB) nằm ở gốc repo, **chưa xoá**. Chúng
là đầu vào của bảng rút gọn; xoá được nếu không cần tái lập. Không được commit (đã có trong
`.gitignore` chưa: **chưa kiểm tra**).
