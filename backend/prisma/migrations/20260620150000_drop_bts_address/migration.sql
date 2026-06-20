-- Drop bts_stations.address — column luôn NULL vì Combain API không trả
-- địa chỉ (chỉ trả tọa độ + accuracy). Không có code đọc/ghi giá trị thực.
ALTER TABLE "bts_stations" DROP COLUMN "address";
